/**
 * Credenciais do Power BI/Fabric na config compartilhada (`~/.nio/config.env`).
 *
 * Existe porque o `nio config check` dizia "config ok" e o `nio fabric` logo depois
 * recusava por falta de credencial: o wizard só conhecia banco e JWT, então quem
 * entrava novo no time não tinha caminho suportado — só editar o arquivo à mão.
 *
 * Consultivo de propósito: nem todo perfil usa Fabric, então a ausência **avisa** e
 * não reprova (mesmo tratamento do backend de IA).
 */
import { input, password, select } from '../prompts.js';
import { c, sym } from '../colors.js';
import { createTokenProvider, fabricGrant, readFabricAuthEnv } from '../../adapters/fabric/token.js';

/** Como a equipe autentica no Fabric. */
export type FabricGrantChoice = 'service_principal' | 'user' | 'skip';

export interface FabricConfigStatus {
  /** Grant que o env habilita hoje, ou `null` se falta credencial. */
  grant: 'user' | 'service_principal' | null;
  /** Ids do modelo semântico default, se configurados. */
  hasTarget: boolean;
}

export function fabricConfigStatus(env: NodeJS.ProcessEnv = process.env): FabricConfigStatus {
  return {
    grant: fabricGrant(readFabricAuthEnv(env)),
    hasTarget: Boolean(env.NIO_FABRIC_WORKSPACE?.trim() && env.NIO_FABRIC_DATASET?.trim()),
  };
}

/** Linha de status pro `nio config check` — nunca reprova. */
export function describeFabricConfig(status: FabricConfigStatus): string {
  if (!status.grant) {
    return (
      `${c.yellow(sym.warn)} Fabric — ${c.dim('sem credencial.')} ` +
      `${c.dim('`nio fabric` e as tools nio_fabric_* não funcionam; rode `nio config setup`.')}`
    );
  }
  const modo = status.grant === 'user' ? 'token de usuário (respeita RLS)' : 'service principal';
  const alvo = status.hasTarget ? '' : ` ${c.dim('— sem workspace/dataset default')}`;
  return `${c.green(sym.ok)} Fabric — ${c.dim(modo)}${alvo}.`;
}

/**
 * Ordem e textos medidos, não supostos: no tenant da NaturalFarms o service principal
 * **lista** workspaces/datasets e sincroniza schema, mas o `executeQueries` devolve
 * `401 PowerBINotAuthorizedException`. O token de usuário executa. Por isso ele vem
 * primeiro e é o default — a opção anterior ("o mesmo pra toda a equipe") soava como a
 * escolha de time e levava direto ao caminho que não consulta.
 */
export const GRANT_CHOICES = [
  {
    name: 'Token de usuário — executa consultas e respeita o RLS (recomendado)',
    value: 'user' as const,
  },
  {
    name: 'Service principal — lista e sincroniza schema; CONSULTA pode dar 401',
    value: 'service_principal' as const,
  },
  { name: 'Pular — não uso Power BI/Fabric', value: 'skip' as const },
];

async function promptGrant(current: FabricConfigStatus): Promise<FabricGrantChoice> {
  return select<FabricGrantChoice>({
    message: 'Como autenticar no Power BI/Fabric?',
    default: current.grant ?? 'user',
    choices: GRANT_CHOICES,
  });
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guidOrEmpty = (v: string): true | string =>
  v.trim() === '' || GUID.test(v.trim()) || 'precisa ser um GUID';

/** Tenant + client id: comuns aos dois grants (o app registrado é o mesmo). */
async function promptApp(file: Record<string, string>): Promise<Record<string, string>> {
  const tenant = (
    await input({
      message: 'AZURE_TENANT_ID  (GUID do tenant da NaturalFarms)',
      default: file.AZURE_TENANT_ID ?? process.env.AZURE_TENANT_ID,
      validate: (v) => GUID.test(v.trim()) || 'precisa ser um GUID',
    })
  ).trim();
  const client = (
    await input({
      message: 'AZURE_CLIENT_ID  (GUID do app registrado)',
      default: file.AZURE_CLIENT_ID ?? process.env.AZURE_CLIENT_ID,
      validate: (v) => GUID.test(v.trim()) || 'precisa ser um GUID',
    })
  ).trim();
  return { AZURE_TENANT_ID: tenant, AZURE_CLIENT_ID: client };
}

/** Workspace/dataset default — o que as tools usam quando o agente não passa ids. */
async function promptTarget(file: Record<string, string>): Promise<Record<string, string>> {
  const workspace = (
    await input({
      message: 'NIO_FABRIC_WORKSPACE  (GUID do workspace default — vazio pula)',
      default: file.NIO_FABRIC_WORKSPACE ?? process.env.NIO_FABRIC_WORKSPACE ?? '',
      validate: guidOrEmpty,
    })
  ).trim();
  const dataset = (
    await input({
      message: 'NIO_FABRIC_DATASET  (GUID do modelo semântico default — vazio pula)',
      default: file.NIO_FABRIC_DATASET ?? process.env.NIO_FABRIC_DATASET ?? '',
      validate: guidOrEmpty,
    })
  ).trim();
  return { NIO_FABRIC_WORKSPACE: workspace, NIO_FABRIC_DATASET: dataset };
}

/**
 * Pergunta as credenciais. Devolve o mapa de updates pro `writeConfigFile` — chave
 * com string vazia é removida do arquivo, que é como se troca de grant sem deixar
 * credencial órfã para trás.
 */
export async function promptFabricCredentials(
  file: Record<string, string>,
): Promise<Record<string, string> | null> {
  const grant = await promptGrant(fabricConfigStatus());
  if (grant === 'skip') return null;

  const updates = { ...(await promptApp(file)) };

  if (grant === 'service_principal') {
    updates.AZURE_CLIENT_SECRET = (
      await password({ message: 'AZURE_CLIENT_SECRET  (segredo do app)', mask: '*' })
    ).trim();
    // Sem o par de usuário o grant fica determinístico — senão o token vira ROPC sozinho.
    updates.NIO_FABRIC_USERNAME = '';
    updates.NIO_FABRIC_PASSWORD = '';
  } else {
    console.log(
      c.dim('  o RLS é por pessoa: esta conta é sua, não a compartilhe com o time.'),
    );
    updates.NIO_FABRIC_USERNAME = (
      await input({
        message: 'NIO_FABRIC_USERNAME  (e-mail da conta)',
        default: file.NIO_FABRIC_USERNAME ?? process.env.NIO_FABRIC_USERNAME,
        validate: (v) => v.includes('@') || 'precisa ser um e-mail',
      })
    ).trim();
    updates.NIO_FABRIC_PASSWORD = await password({
      message: 'NIO_FABRIC_PASSWORD  (senha da conta)',
      mask: '*',
    });
    // App confidencial ainda exige o secret junto do ROPC; vazio é aceito.
    updates.AZURE_CLIENT_SECRET = (
      await password({ message: 'AZURE_CLIENT_SECRET  (vazio se o app é público)', mask: '*' })
    ).trim();
  }

  Object.assign(updates, await promptTarget(file));
  return updates;
}

/**
 * Testa a credencial contra o Azure AD antes de salvar. Não usa o env do processo:
 * valida exatamente o que o wizard acabou de coletar.
 */
export async function verifyFabricCredentials(
  updates: Record<string, string>,
): Promise<{ ok: boolean; detail: string }> {
  const env = { ...process.env, ...updates } as NodeJS.ProcessEnv;
  const auth = readFabricAuthEnv(env);
  const res = await createTokenProvider(auth).get();
  if (res.status !== 'ok') return { ok: false, detail: res.error ?? res.status };

  const modo = res.grant === 'user' ? 'token de usuário' : 'service principal';
  const consulta = await verifyCanQuery(env);
  if (consulta === null) return { ok: true, detail: `credencial válida (${modo})` };
  if (consulta.ok) return { ok: true, detail: `credencial válida (${modo}) e consulta executada` };
  return { ok: false, detail: consulta.detail };
}

/**
 * Pegar token não prova que dá pra consultar: **medido** neste tenant, o service
 * principal obtém token e lista tudo, mas `executeQueries` devolve 401. Validar só a
 * porta de entrada deixava o erro estourar no meio de uma sessão, horas depois.
 *
 * `null` quando não há workspace/dataset para testar — aí não dá pra afirmar nada.
 */
async function verifyCanQuery(
  env: NodeJS.ProcessEnv,
): Promise<{ ok: boolean; detail: string } | null> {
  const workspaceId = env.NIO_FABRIC_WORKSPACE?.trim();
  const datasetId = env.NIO_FABRIC_DATASET?.trim();
  if (!workspaceId || !datasetId) return null;

  const { createFabricGateway } = await import('../../adapters/fabric/client.js');
  const { createTokenProvider: novoProvider } = await import('../../adapters/fabric/token.js');
  const gw = createFabricGateway({ token: novoProvider(readFabricAuthEnv(env)) });
  const out = await gw.executeDax(workspaceId, datasetId, 'EVALUATE ROW("nio", 1)');
  if (out.status === 'ok') return { ok: true, detail: 'consulta executada' };

  const grant = fabricGrant(readFabricAuthEnv(env));
  const dica =
    grant === 'service_principal'
      ? ' — o service principal lista, mas não executa consulta neste locatário. ' +
        'Rode de novo e escolha "Token de usuário".'
      : '';
  return { ok: false, detail: `autenticou, mas a consulta falhou: ${out.error ?? out.status}${dica}` };
}