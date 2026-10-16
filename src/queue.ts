/** An async iterable you can push into: the SDK reads user messages from it for as long as the session lives. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((result: IteratorResult<T, undefined>) => void)[] = [];
  private closed = false;

  push(item: T) {
    if (this.closed) return;
    const next = this.waiting.shift();
    if (next) next({ value: item, done: false });
    else this.items.push(item);
  }

  close() {
    this.closed = true;
    for (const next of this.waiting.splice(0)) next({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
    };
  }
}
