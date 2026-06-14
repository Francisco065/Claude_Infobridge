from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    # Banco de Dados
    database_url: str

    # Redis / Celery
    redis_url: str
    celery_broker_url: str
    celery_result_backend: str

    # Multiportal
    multiportal_base_url: str = 'http://apiv1.multiportal.com.br:9870'
    multiportal_polling_interval: int = 120   # segundos

    # Criptografia (AES-256 para senhas da Multiportal)
    encryption_key: str

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
    comp_ignicao:       int = 1
    comp_odometro_gps:  int = 10
    comp_rpm_basico:    int = 90
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
    comp_acelerador_obd2: int = 9445


@lru_cache
def get_settings() -> Settings:
    return Settings()
