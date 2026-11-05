export class KeyStore {
  #value = "";

  set(value: string): void {
    this.#value = value.trim();
  }

  get(): string {
    return this.#value;
  }

  clear(): void {
    this.#value = "";
  }

  has(): boolean {
    return this.#value !== "";
  }
}
