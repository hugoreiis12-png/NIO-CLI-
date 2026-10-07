/**
 * Contrato de identidade do NIO: quem ele diz que é, o que ele fala e quando.
 * Fonte única — o texto falado sai daqui, então nome, sigla e missão nunca
 * divergem entre a fala, o teste e qualquer superfície futura.
 *
 * Regras do contrato (o teste as impõe):
 *  - sempre 1ª pessoa, pt-BR, "Agente NIO" do NIOP;
 *  - a fala traz nome, sigla, nome por extenso e missão;
 *  - não afirma ser humano, nem cita modelo/fornecedor.
 */
import { ANIM } from '../avatar.js';

export const IDENTITY = {
  agent: 'Agente NIO',
  org: 'NIOP',
  orgFull: 'Núcleo de Inteligência Operacional',
  mission:
    'elevar o desempenho do setor nas demandas de análise, programação e o que mais a operação exigir',
} as const;

// ─── Detector ──────────────────────────────────────────────────────────

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CORE = [
  'quem (?:e|eh) (?:voce|vc|tu|o nio|o agente nio|esse agente)',
  'quem (?:voce|vc) (?:e|eh)',
  'voce (?:e|eh) quem',
  'quem es',
  'qual (?:e )?(?:o )?(?:seu|teu) nome',
  'como (?:voce )?(?:se chama|te chamas)',
  'o que (?:e voce|voce e)',
  '(?:pode )?(?:se )?apresent(?:e|a|ar)(?: se)?',
  '(?:who|what) are you',
].join('|');
const FILLER_BEFORE = '(?:(?:oi|ola|e ai|ei|entao|afinal|me diz|me fala|diga|fale) )*';
const FILLER_AFTER = '(?: (?:mesmo|afinal|exatamente|ai|hein|agora))*';
const IDENTITY_QUESTION = new RegExp(`^${FILLER_BEFORE}(?:${CORE})${FILLER_AFTER}$`);

/**
 * É um "quem é você?" (ou variação curta)? Ancorado de propósito: frase longa
 * que só contém o trecho ("quem é você no git blame?") segue pro modelo.
 */
export function isIdentityQuestion(text: string): boolean {
  return IDENTITY_QUESTION.test(normalize(text));
}

// ─── Roteiro ───────────────────────────────────────────────────────────

interface Beat {
  text: string;
  /** ms por caractere digitado. */
  charMs: number;
  /** pausa depois de terminar de digitar. */
  pauseMs: number;
}

const SUSPENSE: readonly Beat[] = [
  { text: '. . .', charMs: 150, pauseMs: 300 },
  { text: 'Alguém acabou de perguntar quem eu sou.', charMs: 35, pauseMs: 400 },
  { text: 'Então observe…', charMs: 50, pauseMs: 400 },
];

export const SPOKEN: readonly string[] = [
  `Eu sou o ${IDENTITY.agent}.`,
  `Do ${IDENTITY.org} — ${IDENTITY.orgFull}.`,
  `Estou aqui para ajudar na missão de ${IDENTITY.mission}.`,
  'Qual é a missão de hoje?',
];

const SPOKEN_CHAR_MS = 18;
const SPOKEN_PAUSE_MS = 350;
/** Folga entre o fim da suspense e o personagem começar a se formar. */
const SPRITE_DELAY_MS = 300;
/** Pausa final antes de entregar o controle de volta ao input. */
const TAIL_MS = 700;

interface Scheduled {
  text: string;
  start: number;
  charMs: number;
}

function schedule(beats: readonly Beat[], from: number): { items: Scheduled[]; end: number } {
  const items: Scheduled[] = [];
  let at = from;
  for (const b of beats) {
    items.push({ text: b.text, start: at, charMs: b.charMs });
    at += b.text.length * b.charMs + b.pauseMs;
  }
  return { items, end: at };
}

const SUSPENSE_PLAN = schedule(SUSPENSE, 0);
const SPRITE_START = SUSPENSE_PLAN.end + SPRITE_DELAY_MS;
const INTEGRATE_MS = ANIM.integrateFrames * ANIM.frameMs;
const SPOKEN_PLAN = schedule(
  SPOKEN.map((text) => ({ text, charMs: SPOKEN_CHAR_MS, pauseMs: SPOKEN_PAUSE_MS })),
  SPRITE_START + INTEGRATE_MS,
);
/** Duração total do roteiro, em ms. */
export const REVEAL_MS = SPOKEN_PLAN.end + TAIL_MS;

export interface RevealView {
  suspense: string[];
  /** `null` = o personagem ainda não começou a se formar. */
  sprite: { kind: 'integrate' | 'hold'; i: number } | null;
  spoken: string[];
  done: boolean;
}

const typed = (item: Scheduled, t: number): string | null => {
  if (t < item.start) return null;
  return item.text.slice(0, Math.floor((t - item.start) / item.charMs) + 1);
};

const visible = (plan: Scheduled[], t: number): string[] =>
  plan.flatMap((item) => typed(item, t) ?? []);

/** O que aparece na tela `t` ms depois do início. `t` além do fim = estado final. */
export function revealAt(t: number): RevealView {
  const at = Math.min(Math.max(t, 0), REVEAL_MS);
  let sprite: RevealView['sprite'] = null;
  if (at >= SPRITE_START) {
    const i = Math.floor((at - SPRITE_START) / ANIM.frameMs);
    sprite =
      i < ANIM.integrateFrames
        ? { kind: 'integrate', i }
        : { kind: 'hold', i: i - ANIM.integrateFrames };
  }
  return {
    suspense: visible(SUSPENSE_PLAN.items, at),
    sprite,
    spoken: visible(SPOKEN_PLAN.items, at),
    done: t >= REVEAL_MS,
  };
}
