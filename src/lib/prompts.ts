import {
  text,
  password as clackPassword,
  confirm as clackConfirm,
  select as clackSelect,
  multiselect,
  isCancel,
  cancel,
} from '@clack/prompts';

/**
 * Wrapper drop-in do `@clack/prompts` com a MESMA assinatura que o CLI já usava
 * do `@inquirer/prompts` — então trocar o cliente de prompts é só mudar o import.
 *
 * Extras que o clack traz de graça: gutter `│`, símbolos `◇/◆/✓`, e cancelamento
 * (Ctrl-C) tratado de forma central por `unwrap()` (encerra limpo em vez de stack).
 */

/** Encerra limpo se o usuário cancelar (Ctrl-C) qualquer prompt. */
function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Operação cancelada.');
    process.exit(130);
  }
  return value as T;
}

/**
 * Converte o `validate` do inquirer (`(v: string) => true | string`) pro do clack
 * (`Validate<string>` = `(v: string | undefined) => string | undefined`).
 */
function adaptValidate(
  validate?: (value: string) => boolean | string,
): ((value: string | undefined) => string | undefined) | undefined {
  if (!validate) return undefined;
  return (value: string | undefined) => {
    const result = validate(value ?? '');
    return result === true ? undefined : (result as string) || undefined;
  };
}

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
}

export async function password(opts: {
  message: string;
  mask?: string;
  validate?: (value: string) => boolean | string;
}): Promise<string> {
  return unwrap(
    await clackPassword({
      message: opts.message,
      mask: opts.mask,
      validate: adaptValidate(opts.validate),
    }),
  );
}

export async function input(opts: {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string;
}): Promise<string> {
  return unwrap(
    await text({
      message: opts.message,
      initialValue: opts.default,
      validate: adaptValidate(opts.validate),
    }),
  );
}

export async function confirm(opts: { message: string; default?: boolean }): Promise<boolean> {
  return unwrap(await clackConfirm({ message: opts.message, initialValue: opts.default }));
}

// `Option<Value>` do clack é um tipo condicional sobre `Value`; com `T` genérico
// ele não resolve, então usamos um shape mínimo e casamos (`as never`). O retorno
// segue tipado via `as T` / `as T[]`.
type ClackOption<T> = { value: T; label: string; hint?: string };

export async function select<T>(opts: {
  message: string;
  choices: Choice<T>[];
  default?: T;
}): Promise<T> {
  const options: ClackOption<T>[] = opts.choices.map((ch) => ({
    value: ch.value,
    label: ch.name,
    hint: ch.description,
  }));
  return unwrap(
    await clackSelect({ message: opts.message, options: options as never, initialValue: opts.default }),
  ) as T;
}

/** Sentinela da opção "Todos" — `Symbol` não colide com nenhum valor real de `T`. */
const SELECT_ALL = Symbol("select-all");

export async function checkbox<T>(opts: {
  message: string;
  choices: Choice<T>[];
  /** Prepende uma opção "marca tudo" (rótulo custom se string). Expande pra todos. */
  all?: boolean | string;
}): Promise<T[]> {
  const withAll = Boolean(opts.all) && opts.choices.length > 1;
  const allLabel = typeof opts.all === "string" ? opts.all : "Todos";
  const options: ClackOption<unknown>[] = [
    ...(withAll ? [{ value: SELECT_ALL, label: allLabel, hint: "marca tudo" }] : []),
    ...opts.choices.map((ch) => ({ value: ch.value, label: ch.name, hint: ch.description })),
  ];
  const picked = unwrap(
    await multiselect({ message: opts.message, options: options as never, required: false }),
  ) as unknown[];
  if (withAll && picked.includes(SELECT_ALL)) {
    return opts.choices.map((ch) => ch.value);
  }
  return picked.filter((v) => v !== SELECT_ALL) as T[];
}
