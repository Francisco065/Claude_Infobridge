"""
classificador.py

Encapsula todas as regras de classificação do motor de raciocínio:
  - Faixas de RPM
  - Faixas de pressão do acelerador
  - Detecção de embalo
  - Classificação de frenagens

Mantido separado para facilitar testes unitários e futuras
alterações de limiares sem mexer na lógica de cálculo.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

FaixaRPM        = Literal['abaixo_verde', 'verde_inicial', 'verde_final',
                           'freio_motor_ok', 'freio_motor_acelerando', 'acima']
FaixaAcelerador = Literal['ideal', 'atencao', 'critico']
TipoFrenagem    = Literal['normal', 'brusca'] | None


@dataclass
class ResultadoFrenagem:
    tipo:              TipoFrenagem     # None = não é frenagem
    desaceleracao_ms2: float
    alta_velocidade:   bool             # True se vel antes > 70 km/h


class Classificador:
    """
    Todas as regras de classificação do motor.
    Instanciar uma vez e reutilizar (stateless).
    """

    def __init__(self, cfg) -> None:
        self.cfg = cfg

    # ── Faixa de RPM ─────────────────────────────────────────

    def classificar_rpm(
        self,
        rpm: int | None,
        perc_acelerador: float | None,
    ) -> FaixaRPM | None:
        """
        Classifica a faixa de RPM cruzada com uso do acelerador.

        Faixas definidas:
          • abaixo_verde       : RPM < 1300 (marcha-lenta / banguela)
          • verde_inicial      : 1300–1899 RPM  → faixa ideal de condução
          • verde_final        : 1900–2099 RPM  → faixa de atenção
          • freio_motor_ok     : 2100–2800 RPM + acelerador < 7%  → uso correto
          • freio_motor_aceler : 2100–2800 RPM + acelerador ≥ 7%  → uso indevido
          • acima              : RPM > 2800 (acima do limite)
        """
        if rpm is None:
            return None

        c = self.cfg
        if rpm < c.rpm_verde_inicial_min:
            return 'abaixo_verde'
        if rpm <= c.rpm_verde_inicial_max:
            return 'verde_inicial'
        if rpm <= c.rpm_verde_final_max:
            return 'verde_final'
        if c.rpm_freio_motor_min <= rpm <= c.rpm_freio_motor_max:
            acel = perc_acelerador or 0.0
            return 'freio_motor_ok' if acel < c.rpm_acelerador_embalo_max \
                   else 'freio_motor_acelerando'
        return 'acima'

    # ── Faixa do Acelerador ───────────────────────────────────

    def classificar_acelerador(
        self,
        perc_acelerador: float | None,
    ) -> FaixaAcelerador | None:
        """
        Classifica a pressão do pedal do acelerador:
          • ideal   : ≤ 60%
          • atencao : 61–70%
          • critico : ≥ 71%
        """
        if perc_acelerador is None:
            return None
        if perc_acelerador <= self.cfg.acel_ideal_max:
            return 'ideal'
        if perc_acelerador <= self.cfg.acel_atencao_max:
            return 'atencao'
        return 'critico'

    # ── Detecção de Embalo ────────────────────────────────────

    def detectar_embalo(
        self,
        velocidade: int | None,
        perc_acelerador: float | None,
        embreagem: bool | None,
    ) -> bool:
        """
        Detecta se o veículo está em embalo (marcha engatada sem aceleração,
        ou Eco-Roll/I-Roll para veículos equipados).

        Regra principal (quando embreagem CAN disponível):
          velocidade > 0 AND acelerador = 0% AND embreagem = desengrenada (False)

        Fallback (sem dado de embreagem):
          velocidade > 0 AND acelerador = 0%
          → não tão preciso pois pode confundir desaceleração no freio com embalo
        """
        vel = velocidade or 0
        if vel <= 0:
            return False

        acel = perc_acelerador
        if acel is None:
            return False   # sem dado de acelerador, não conseguimos afirmar

        if acel > 0:
            return False   # está acelerando, não é embalo

        # Com embreagem CAN: só é embalo se a embreagem estiver desengrenada
        if embreagem is not None:
            return embreagem is False   # False = pedal não pressionado = engatado
                                        # True  = pedal pressionado = desengrenado
        # Fallback sem embreagem: acelerador em 0 e em movimento
        return True

    # ── Detecção de Frenagem ──────────────────────────────────

    def classificar_frenagem(
        self,
        velocidade_antes_kmh: float,
        velocidade_depois_kmh: float,
        delta_t_s: float,
    ) -> ResultadoFrenagem:
        """
        Classifica a frenagem com base na variação de velocidade.

        Limiares:
          • < 2,00 m/s² → não é frenagem (variação normal)
          • 2,00–2,93 m/s² → frenagem normal
          • ≥ 2,94 m/s² (0,30g) → frenagem brusca

        Conversão: Δv km/h → m/s = Δv / 3,6
        """
        delta_v_kmh = velocidade_antes_kmh - velocidade_depois_kmh
        if delta_v_kmh <= 0 or delta_t_s <= 0:
            return ResultadoFrenagem(None, 0.0, False)

        delta_v_ms       = delta_v_kmh / 3.6
        desaceleracao    = delta_v_ms / delta_t_s
        alta_velocidade  = velocidade_antes_kmh > self.cfg.frenagem_alta_vel_kmh

        if desaceleracao < self.cfg.frenagem_min_ms2:
            return ResultadoFrenagem(None, desaceleracao, alta_velocidade)

        tipo = 'brusca' if desaceleracao >= self.cfg.frenagem_brusca_ms2 else 'normal'
        return ResultadoFrenagem(tipo, desaceleracao, alta_velocidade)

    # ── Detecção de Parada (Motor Ocioso) ─────────────────────

    def is_parada_com_motor(
        self,
        ignicao: bool | None,
        velocidade: int | None,
    ) -> bool:
        """
        Retorna True se o veículo está parado com motor ligado
        (candidato a motor ocioso).
        A tolerância de 5 min é aplicada na agregação em calculador_indicadores.py.
        """
        return ignicao is True and (velocidade or 0) == 0

    # ── Classificação de Excesso de Velocidade ────────────────

    def excede_velocidade(self, velocidade: int | None) -> bool:
        """Retorna True se a velocidade ultrapassa o limite configurado (90 km/h)."""
        return (velocidade or 0) > self.cfg.velocidade_excesso_kmh
