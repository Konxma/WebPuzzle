export abstract class ObservableViewModel<TState> {
  private listeners = new Set<() => void>();
  protected constructor(private state: TState) {}
  readonly getSnapshot = (): TState => this.state;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  protected setState(state: TState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
