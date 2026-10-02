/**
 * Универсальный пул объектов для повторного использования спрайтов, меток и графических элементов.
 * Не зависит от Pixi.js.
 */
export class ObjectPool<T> {
  private readonly _pool: T[] = [];
  private readonly _factory: () => T;
  private readonly _reset?: (item: T) => void;

  constructor(factory: () => T, reset?: (item: T) => void) {
    this._factory = factory;
    this._reset = reset;
  }

  get size(): number {
    return this._pool.length;
  }

  /**
   * Получает свободный объект из пула или создает новый через фабрику.
   */
  acquire(): T {
    return this._pool.pop() ?? this._factory();
  }

  /**
   * Возвращает объект в пул, применяя функцию сброса (reset), если задана.
   */
  release(item: T): void {
    if (this._reset) {
      this._reset(item);
    }
    this._pool.push(item);
  }

  /**
   * Возвращает коллекцию объектов в пул.
   */
  releaseAll(items: Iterable<T>): void {
    for (const item of items) {
      this.release(item);
    }
  }

  /**
   * Очищает пул, опционально вызывая деструктор для каждого элемента.
   */
  clear(dispose?: (item: T) => void): void {
    if (dispose) {
      for (const item of this._pool) {
        dispose(item);
      }
    }
    this._pool.length = 0;
  }
}
