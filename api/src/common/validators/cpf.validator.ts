import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * Valida um CPF real: 11 dígitos + dígitos verificadores.
 * Rejeita sequências de dígitos iguais (ex.: 11111111111).
 */
export function ehCpfValido(valor: string): boolean {
  const c = (valor ?? '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const digito = (base: number): number => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += parseInt(c[i], 10) * (base + 1 - i);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  return digito(9) === parseInt(c[9], 10) && digito(10) === parseInt(c[10], 10);
}

@ValidatorConstraint({ name: 'isCpf', async: false })
export class IsCpfConstraint implements ValidatorConstraintInterface {
  validate(valor: string) {
    return ehCpfValido(valor);
  }
  defaultMessage() {
    return 'CPF inválido (informe um CPF real com 11 dígitos)';
  }
}

export function IsCpf(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsCpfConstraint,
    });
  };
}
