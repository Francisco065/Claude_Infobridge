import os
from urllib.parse import quote
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator
from functools import lru_cache


def _montar_dsn_do_ambiente() -> str | None:
    """
    Tenta montar a string de conexão a partir das variáveis que o Railway
    (e a maioria dos provedores) injeta. Ordem de prioridade:
      1. DATABASE_URL / DATABASE_PRIVATE_URL / DATABASE_PUBLIC_URL / POSTGRES_URL
      2. PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT (montagem manual)
    Retorna None se nada utilizável for encontrado.
    """
    for chave in ('DATABASE_URL', 'DATABASE_PRIVATE_URL', 'DATABASE_PUBLIC_URL', 'POSTGRES_URL'):
        valor = os.getenv(chave)
        if valor and '://' in valor:
            return valor

    host = os.getenv('PGHOST') or os.getenv('POSTGRES_HOST')
    user = os.getenv('PGUSER') or os.getenv('POSTGRES_USER')
    pwd  = os.getenv('PGPASSWORD') or os.getenv('POSTGRES_PASSWORD')
    db   = os.getenv('PGDATABASE') or os.getenv('POSTGRES_DB')
    port = os.getenv('PGPORT') or os.getenv('POSTGRES_PORT') or '5432'
    if host and user and db:
        senha = f':{quote(pwd, safe="")}' if pwd else ''
        return f'postgresql://{user}{senha}@{host}:{port}/{db}'

    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    # Banco de Dados — opcional aqui; se vazio, montamos a partir do ambiente
    database_url: str | None = None

    @model_validator(mode='after')
    def _garantir_database_url(self):
        if not self.database_url or '://' not in self.database_url:
            montada = _montar_dsn_do_ambiente()
            if montada:
                object.__setattr__(self, 'database_url', montada)
        return self

    # Redis — não usado mais (sem Celery), mantido opcional para compatibilidade
    redis_url: str | None = None

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.redis_url

    # Multiportal
    multiportal_base_url: str = 'http://apiv1.multiportal.com.br:9870'
    multiportal_polling_interval: int = 120   # segundos

    # Criptografia (AES-256 para senhas da Multiportal) — opcional por enquanto
    encryption_key: str | None = None

    # Logging
    log_level: str = 'info'

    # Claude API (geração de notas via LLM — opcional)
    anthropic_api_key: str | None = None

    # Limiares do motor de raciocínio (configuráveis por env)
    rpm_verde_inicial_min:   int   = 1300
    rpm_verde_inicial_max:   int   = 1899
    rpm_verde_final_min:     int   = 1900
    rpm_verde_final_max:     int   = 2099
    rpm_freio_motor_min:     int   = 2100
    rpm_freio_motor_max:     int   = 2800
    rpm_acelerador_embalo_max: float = 7.0     # % acelerador para considerar freio motor

    acel_ideal_max:          float = 60.0      # % acelerador ideal
    acel_atencao_max:        float = 70.0      # % acelerador — atenção

    frenagem_min_ms2:        float = 2.00      # m/s² — limiar mínimo para frenagem
    frenagem_brusca_ms2:     float = 2.94      # m/s² — 0,30g
    frenagem_alta_vel_kmh:   float = 70.0      # km/h — "frenagem em alta velocidade"

    velocidade_excesso_kmh:  float = 90.0      # km/h — excesso de velocidade
    excesso_tolerancia_perc: float = 10.0      # % de posições toleradas por janela de 1h

    motor_ocioso_tolerancia_s: int = 300       # 5 minutos por parada

    # Pesos da Nota de Desempenho (devem somar 0.90)
    peso_faixa_verde:        float = 0.25
    peso_embalo:             float = 0.10
    peso_motor_ocioso:       float = 0.20
    peso_acelerando_critico: float = 0.25
    peso_excesso_velocidade: float = 0.10

    # Pesos da Pontuação Final
    peso_pontos_performance: float = 600.0     # pontos máx para desempenho
    peso_pontos_km:          float = 400.0     # pontos máx para km rodado

    @property
    def soma_pesos_nota(self) -> float:
        return (
            self.peso_faixa_verde +
            self.peso_embalo +
            self.peso_motor_ocioso +
            self.peso_acelerando_critico +
            self.peso_excesso_velocidade
        )

    # IDs de componentes Multiportal (fontes primárias e alternativas)
    # Ordem de preferência sempre: Rede CAN → OBD2 → GPS/básico.
    comp_ignicao_can:   int = 9201   # Ignição CAN (preferencial)
    comp_ignicao:       int = 1      # Ignição do rastreador (fallback)
    comp_odometro_gps:  int = 10
    comp_rpm_basico:    int = 95     # RPM (Instantâneo) — fallback
    comp_rpm_media:     int = 90     # RPM (Média) — último fallback
    comp_odometro_can:  int = 9088
    comp_rpm_can:       int = 9090
    comp_consumo_can:   int = 9092
    comp_consumo_total_can: int = 9202
    comp_acelerador_can: int = 9208
    comp_motor_ocioso_can: int = 9210
    comp_cruise_ctrl:   int = 9224
    comp_pedal_freio:   int = 9225
    comp_embreagem:     int = 9226
    comp_rpm_obd2:      int = 9182
    comp_consumo_total_obd2: int = 9443
    # OBD2: pedal do acelerador — variantes A–F (o device pode usar qualquer uma).
    comp_acelerador_obd2: int = 9445       # Posição do pedal do acelerador
    comp_acelerador_obd2_alt: int = 9171   # Posição relativa do pedal
    comp_acelerador_obd2_f: int = 9172     # Posição do Pedal F
    comp_acelerador_obd2_e: int = 9173     # Posição do Pedal E
    comp_acelerador_obd2_d: int = 9176     # Posição do Pedal D
    comp_acelerador_obd2_c: int = 9177     # Posição absoluta C
    comp_acelerador_obd2_b: int = 9178     # Posição absoluta B

    # Velocidade — antes só GPS (campo top-level). Agora CAN → OBD2 → GPS.
    comp_velocidade_can:  int = 9089  # Velocidade via Rede CAN
    comp_velocidade_obd2: int = 9183  # OBD2: Velocidade do Veículo

    # Nível de combustível (%) — CAN → OBD2 → Omnicomm → genérico.
    comp_nivel_comb_pct_can:  int = 9206  # Nível de Combustível em Percentual CAN
    comp_nivel_comb_obd2:     int = 9179  # OBD2: Nível do tanque de combustível
    comp_nivel_comb_omnicomm: int = 9052  # Nível de combustível (Omnicomm)
    comp_nivel_comb_generico: int = 9167  # Nível Combustível


@lru_cache
def get_settings() -> Settings:
    return Settings()
