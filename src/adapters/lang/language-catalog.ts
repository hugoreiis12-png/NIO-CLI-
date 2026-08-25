/**
 * Catálogo hardcoded de recipes de ambiente por linguagem — implementação do
 * port `LanguageCatalog` (core/lang.ts). Novo campo = editar aqui. Sem IO.
 */
import type { LanguageId, LanguageCatalog, LanguageRecipe } from '../../core/lang.js';

const RECIPES: Record<LanguageId, LanguageRecipe> = {
  typescript: {
    language: 'typescript',
    runtime: 'node',
    packageManagers: ['npm', 'pnpm', 'yarn'],
    baseLibs: [],
    frameworks: [
      'NestJS', 'Express.js', 'Fastify', 'Hono', 'Koa.js',
      'Angular', 'Next.js', 'Nuxt', 'SvelteKit', 'AdonisJS', 'tRPC', 'Mastra',
    ],
    orms: [
      'Prisma', 'TypeORM', 'Sequelize', 'Objection.js', 'MikroORM',
      'Knex.js', 'Mongoose', 'Kysely', 'Typegoose',
    ],
    typings: ['typescript', '@types/node'],
    mcpSdk: '@modelcontextprotocol/sdk',
  },

  node: {
    language: 'node',
    runtime: 'node',
    packageManagers: ['npm', 'pnpm', 'yarn'],
    baseLibs: [],
    frameworks: [
      'NestJS', 'Express.js', 'Fastify', 'Hono', 'Koa.js',
      'Angular', 'Next.js', 'Nuxt', 'SvelteKit', 'AdonisJS', 'tRPC', 'Mastra',
    ],
    orms: [
      'Prisma', 'TypeORM', 'Sequelize', 'Objection.js', 'MikroORM',
      'Knex.js', 'Mongoose', 'Kysely', 'Typegoose',
    ],
    typings: ['typescript', '@types/node'],
    mcpSdk: '@modelcontextprotocol/sdk',
  },

  python: {
    language: 'python',
    runtime: 'python',
    packageManagers: ['pip', 'uv', 'pipenv', 'poetry', 'conda'],
    baseLibs: [],
    frameworks: [
      'Django', 'FastAPI', 'Flask', 'Pyramid', 'Masonite', 'Bottle', 'CherryPy',
      'Sanic', 'Tornado', 'AIOHTTP', 'Django Ninja', 'PyTorch', 'TensorFlow',
      'Scikit-Learn', 'LangChain', 'LangGraph', 'LlamaIndex', 'CrewAI',
      'Reflex', 'Flet', 'Streamlit', 'Dash',
    ],
    orms: [
      'SQLAlchemy', 'Django ORM', 'SQLModel', 'Tortoise ORM', 'Ormar',
      'Peewee', 'Pony ORM', 'Beanie', 'MongoEngine', 'Redis-OM',
    ],
    typings: [
      'mypy', 'pydantic', 'dataclasses', 'attrs', 'typing-extensions',
      'typeguard', 'pyre-check', 'pytype', 'pyright',
    ],
    mcpSdk: 'mcp',
  },

  csharp: {
    language: 'csharp',
    runtime: 'dotnet',
    packageManagers: ['nuget'],
    baseLibs: [],
    frameworks: ['ASP.NET Core', '.NET Aspire', 'Unity', 'Xamarin', 'Blazor', 'NancyFx'],
    orms: ['Entity Framework Core (EF Core)', 'Dapper', 'RepoDb', 'NHibernate'],
    typings: ['dotnet'],
    mcpSdk: 'ModelContextProtocol',
  },

  n8n: {
    language: 'n8n',
    runtime: 'node',
    packageManagers: ['npm'],
    baseLibs: [],
    frameworks: ['n8n'],
    orms: [],
    typings: ['node'],
    mcpSdk: undefined,
  },
};

export function createLanguageCatalog(): LanguageCatalog {
  return {
    recipe(language: LanguageId): LanguageRecipe {
      const r = RECIPES[language];
      if (!r) throw new Error(`Linguagem "${language}" ainda não tem recipe no catálogo.`);
      return r;
    },
  };
}
