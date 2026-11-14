import type { FoundationHost } from "../objc/host";
const CLASS = "SKPaymentQueue";
interface PaymentHost extends FoundationHost {
  array(values: number[]): number;
}
export function installPaymentQueue(host: PaymentHost): void {
  const klass = host.hostClass(CLASS, "NSObject"),
    observers = new Set<number>();
  let queue = 0;
  host.method(CLASS, true, "defaultQueue", () => (queue ||= host.alloc(klass)));
  host.method(CLASS, true, "canMakePayments", () => 0);
  host.method(CLASS, false, "transactions", () => host.array([]));
  host.method(CLASS, false, "addTransactionObserver:", (_, args) => {
    const observer = args(0);
    if (!observer) throw new Error("A payment observer is required.");
    if (!observers.has(observer)) observers.add(host.retain(observer));
  });
  host.method(CLASS, false, "removeTransactionObserver:", async (_, args) => {
    if (observers.delete(args(0))) await host.release(args(0));
  });
}
