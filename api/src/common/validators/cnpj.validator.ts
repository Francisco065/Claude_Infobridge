import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * Valida um CNPJ real: 14 dígitos + dígitos verificadores.
 * Rejeita sequências de dígitos iguais (ex.: 00000000000000).
 */
export function ehCnpjValido(valor: string): boolean {
  const c = (valor ?? '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;

  const calc = (base: number): number => {
    const pesos = base === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base; i++) soma += parseInt(c[i], 10) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };

  return calc(12) === parseInt(c[12], 10) && calc(13) === parseInt(c[13], 10);
}

@ValidatorConstraint({ name: 'isCnpj', async: false })
export class IsCnpjConstraint implements ValidatorConstraintInterface {
  validate(valor: string) {
    return ehCnpjValido(valor);
  }
  defaultMessage() {
    return 'CNPJ inválido (informe um CNPJ real com 14 dígitos)';
  }
}

export function IsCnpj(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsCnpjConstraint,
    });
  };
}
