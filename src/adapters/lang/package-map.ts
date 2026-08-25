/**
 * Mapa display→pacote (implementa `PackageMap`, core/lang.ts). Só o que estiver
 * mapeado é auto-instalável; o resto cai no marker + aviso "instale manualmente".
 * Os nomes à ESQUERDA batem EXATAMENTE com os de `language-catalog.ts`.
 */
import type { LanguageId, PackageMap } from '../../core/lang.js';

const MAP: Record<LanguageId, Record<string, string>> = {
  // ── referência completa (já preenchi) ──
  typescript: {
    'Next.js': 'next',
    'NestJS': '@nestjs/core',
    'Express.js': 'express',
    'Fastify': 'fastify',
    'Hono': 'hono',
    'Koa.js': 'koa',
    'Angular': '@angular/core',
    'Nuxt': 'nuxt',
    'SvelteKit': '@sveltejs/kit',
    'AdonisJS': '@adonisjs/core',
    'tRPC': '@trpc/server',
    'Mastra': '@mastra/core',
    'Prisma': 'prisma',
    'TypeORM': 'typeorm',
    'Sequelize': 'sequelize',
    'Objection.js': 'objection',
    'MikroORM': '@mikro-orm/core',
    'Knex.js': 'knex',
    'Mongoose': 'mongoose',
    'Kysely': 'kysely',
    'Typegoose': '@typegoose/typegoose',
  },

  // node ≡ typescript (mesmos pacotes npm).
  node: {
    'Next.js': 'next',
    'NestJS': '@nestjs/core',
    'Express.js': 'express',
    'Fastify': 'fastify',
    'Hono': 'hono',
    'Koa.js': 'koa',
    'Angular': '@angular/core',
    'Nuxt': 'nuxt',
    'SvelteKit': '@sveltejs/kit',
    'AdonisJS': '@adonisjs/core',
    'tRPC': '@trpc/server',
    'Mastra': '@mastra/core',
    'Prisma': 'prisma',
    'TypeORM': 'typeorm',
    'Sequelize': 'sequelize',
    'Objection.js': 'objection',
    'MikroORM': '@mikro-orm/core',
    'Knex.js': 'knex',
    'Mongoose': 'mongoose',
    'Kysely': 'kysely',
    'Typegoose': '@typegoose/typegoose',
  },
  python: {
    // frameworks
    Django: 'django',
    FastAPI: 'fastapi',
    Flask: 'flask',
    Pyramid: 'pyramid',
    Masonite: 'masonite',
    Bottle: 'bottle',
    CherryPy: 'cherrypy',
    Sanic: 'sanic',
    Tornado: 'tornado',
    AIOHTTP: 'aiohttp',
    'Django Ninja': 'django-ninja',
    PyTorch: 'torch',
    TensorFlow: 'tensorflow',
    'Scikit-Learn': 'scikit-learn',
    LangChain: 'langchain',
    LangGraph: 'langgraph',
    LlamaIndex: 'llama-index',
    CrewAI: 'crewai',
    Reflex: 'reflex',
    Flet: 'flet',
    Streamlit: 'streamlit',
    Dash: 'dash',
    // ORMs
    SQLAlchemy: 'SQLAlchemy',
    SQLModel: 'sqlmodel',
    'Tortoise ORM': 'tortoise-orm',
    Ormar: 'ormar',
    Peewee: 'peewee',
    'Pony ORM': 'pony',
    Beanie: 'beanie',
    MongoEngine: 'mongoengine',
    'Redis-OM': 'redis-om',
    // 'Django ORM' vem junto do Django (sem pacote próprio) → fallthrough.
  },
  csharp: {
    // ORMs (são pacotes NuGet):
    'Entity Framework Core (EF Core)': 'Microsoft.EntityFrameworkCore',
    Dapper: 'Dapper',
    RepoDb: 'RepoDb',
    NHibernate: 'NHibernate',
    // frameworks NuGet-instaláveis:
    '.NET Aspire': 'Aspire.Hosting',
    NancyFx: 'Nancy',
    // 'ASP.NET Core' / Unity / Xamarin / Blazor vêm do SDK/plataforma
    // (não são `dotnet add package`) → fallthrough (marker + aviso).
  },
  n8n: {
    // n8n não instala pacote de framework/ORM.
  },
};

export function createPackageMap(): PackageMap {
    return {
        resolve(language: LanguageId, displayName: string): string | null{
            return MAP[language]?.[displayName] ?? null;
        },
    };
}


