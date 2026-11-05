export class KeyStore {
  private value = "";

  set(value: string): void {
    this.value = value;
  }

  get(): string {
    return this.value;
  }

  clear(): void {
    this.value = "";
  }

  has(): boolean {
    return this.value !== "";
  }
}
