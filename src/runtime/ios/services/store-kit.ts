import { Argument } from "../objc/host";
import { delegateAccessors, failLater, type ServiceHost } from "./host";

const SK_ERROR_DOMAIN = "SKErrorDomain";
/** SKErrorUnknown: the store cannot be reached. */
const SK_ERROR_UNKNOWN = 0;
const DEFAULT_QUANTITY = 1;

/** SKPayment values and a products request that always fails, as on a device with no store. */
export function installStoreRequests(host: ServiceHost): void {
  host.hostClass("SKPayment", "NSObject");
  host.hostClass("SKMutablePayment", "SKPayment");
  host.hostClass("SKRequest", "NSObject");
  host.hostClass("SKProductsRequest", "SKRequest");
  const products = new Map<number, string>();
  const quantities = new Map<number, number>();
  const make = (klass: number, identifier: number) => {
    const self = host.alloc(klass);
    if (identifier) products.set(self, host.text(identifier));
    return host.autorelease(self);
  };
  host.method("SKPayment", true, "paymentWithProductIdentifier:", (self, args) =>
    make(self, args(Argument.First)),
  );
  host.method("SKPayment", true, "paymentWithProduct:", async (self, args) =>
    make(
      self,
      Number(args(Argument.First) ? await host.send(args(Argument.First), "productIdentifier") : 0),
    ),
  );
  host.method("SKPayment", false, "productIdentifier", (self) => {
    const identifier = products.get(self);
    return identifier === undefined ? 0 : host.string(identifier);
  });
  host.method("SKPayment", false, "quantity", (self) => quantities.get(self) ?? DEFAULT_QUANTITY);
  host.method("SKMutablePayment", false, "setQuantity:", (self, args) => {
    quantities.set(self, args(Argument.First));
  });
  host.method("SKMutablePayment", false, "setProductIdentifier:", (self, args) => {
    if (args(Argument.First)) products.set(self, host.text(args(Argument.First)));
  });
  host.method("SKPayment", false, "dealloc", (self) => {
    products.delete(self);
    quantities.delete(self);
    host.destroy(self);
  });

  const delegates = new Map<number, number>();
  host.method("SKProductsRequest", false, "initWithProductIdentifiers:", (self) => self);
  delegateAccessors(host, "SKRequest", delegates);
  host.method("SKRequest", false, "start", (self) =>
    failLater(
      host,
      () => delegates.get(self) ?? 0,
      "request:didFailWithError:",
      [self],
      () => host.error(SK_ERROR_UNKNOWN, SK_ERROR_DOMAIN),
    ),
  );
  host.method("SKRequest", false, "cancel", (self) => {
    delegates.delete(self);
  });
  host.method("SKRequest", false, "dealloc", (self) => {
    delegates.delete(self);
    host.destroy(self);
  });
}
