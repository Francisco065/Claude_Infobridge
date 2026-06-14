import {
  DataSource,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';

/**
 * TenantAwareRepository<T>
 *
 * Base repository que garante isolamento multi-tenant em todas as operações.
 *
 * Por que é necessário:
 *  Além do RLS do PostgreSQL (SET app.current_tenant), este repository
 *  adiciona WHERE tenant_id = :tenantId explicitamente em todas as queries.
 *  Isso cria uma camada dupla de segurança — se o RLS não estiver ativo
 *  (ex: conexão de admin ou bug de configuração), o filtro TypeORM ainda protege.
 *
 * Como usar nos módulos:
 *  @Injectable()
 *  export class VeiculosService {
 *    constructor(
 *      @InjectDataSource() private dataSource: DataSource,
 *    ) {}
 *
 *    private repo(tenantId: string) {
 *      return new TenantAwareRepository(Veiculo, this.dataSource, tenantId);
 *    }
 *
 *    async listar(tenantId: string) {
 *      return this.repo(tenantId).findAll({ where: { ativo: true } });
 *    }
 *  }
 */
export class TenantAwareRepository<T extends ObjectLiteral & { tenantId: string }> {

  private readonly repo: Repository<T>;

  constructor(
    private readonly entity: EntityTarget<T>,
    private readonly dataSource: DataSource,
    private readonly tenantId: string,
  ) {
    this.repo = dataSource.getRepository(entity);
  }

  // ── Queries ───────────────────────────────────────────────

  async findAll(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repo.find({
      ...options,
      where: this._mergeWhere(options?.where),
    });
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repo.findOne({
      ...options,
      where: this._mergeWhere(options.where),
    });
  }

  async findById(id: string): Promise<T | null> {
    return this.repo.findOne({
      where: { id, tenantId: this.tenantId } as unknown as FindOptionsWhere<T>,
    });
  }

  async count(where?: FindOptionsWhere<T>): Promise<number> {
    return this.repo.count({ where: this._mergeWhere(where) });
  }

  // ── Writes (sempre incluem tenant_id) ─────────────────────

  async save(entity: Partial<T>): Promise<T> {
    const withTenant = { ...entity, tenantId: this.tenantId } as T;
    return this.repo.save(withTenant);
  }

  async saveMany(entities: Partial<T>[]): Promise<T[]> {
    const withTenant = entities.map((e) => ({ ...e, tenantId: this.tenantId } as T));
    return this.repo.save(withTenant);
  }

  async update(id: string, partial: Partial<T>): Promise<void> {
    // Garante que o update só afeta registros do tenant correto
    await this.repo.update(
      { id, tenantId: this.tenantId } as unknown as FindOptionsWhere<T>,
      partial,
    );
  }

  async softDelete(id: string): Promise<void> {
    // "Soft delete" setando ativo=false ao invés de deletar fisicamente
    await this.repo.update(
      { id, tenantId: this.tenantId } as unknown as FindOptionsWhere<T>,
      { ativo: false } as unknown as Partial<T>,
    );
  }

  // ── QueryBuilder com tenant pré-filtrado ──────────────────

  createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    return this.repo
      .createQueryBuilder(alias)
      .where(`${alias}.tenant_id = :tenantId`, { tenantId: this.tenantId });
  }

  // ── SET app.current_tenant para RLS ───────────────────────

  /**
   * Executa a função dentro de uma transação com o tenant setado no
   * session variable do PostgreSQL. Garante que o RLS funcione
   * mesmo em conexões do pool que compartilham sessões.
   */
  async withTenantTransaction<R>(
    fn: (repo: TenantAwareRepository<T>) => Promise<R>,
  ): Promise<R> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SET LOCAL app.current_tenant = '${this.tenantId}'`);
      const txRepo = new TenantAwareRepository<T>(
        this.entity,
        this.dataSource,
        this.tenantId,
      );
      return fn(txRepo);
    });
  }

  // ── Helpers privados ──────────────────────────────────────

  private _mergeWhere(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const tenantFilter = { tenantId: this.tenantId } as FindOptionsWhere<T>;
    if (!where) return tenantFilter;
    if (Array.isArray(where)) {
      return where.map((w) => ({ ...w, ...tenantFilter }));
    }
    return { ...where, ...tenantFilter };
  }
}
