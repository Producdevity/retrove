import { delegateAccessors, failLater, type ServiceHost } from "./host";

const DOMAIN = "kCLErrorDomain";
/** kCLErrorDenied and kCLAuthorizationStatusDenied: the user never grants location access. */
const CL_ERROR_DENIED = 1;
const CL_AUTHORIZATION_DENIED = 2;
const CLASS = "CLLocationManager";
export const LocationSymbols: Readonly<Record<string, string>> = { _kCLErrorDomain: DOMAIN };
/** CLLocationAccuracy constants, exported as doubles in meters. */
export const LocationAccuracy: Readonly<Record<string, number>> = {
  _kCLLocationAccuracyBestForNavigation: -2,
  _kCLLocationAccuracyBest: -1,
  _kCLLocationAccuracyNearestTenMeters: 10,
  _kCLLocationAccuracyHundredMeters: 100,
  _kCLLocationAccuracyKilometer: 1000,
  _kCLLocationAccuracyThreeKilometers: 3000,
};

export function installLocationManager(host: ServiceHost): void {
  host.hostClass(CLASS, "NSObject");
  const delegates = new Map<number, number>();
  host.method(CLASS, false, "init", (self) => self);
  host.method(CLASS, true, "locationServicesEnabled", () => 0);
  host.method(CLASS, false, "locationServicesEnabled", () => 0);
  host.method(CLASS, true, "authorizationStatus", () => CL_AUTHORIZATION_DENIED);
  for (const name of [
    "headingAvailable",
    "significantLocationChangeMonitoringAvailable",
    "regionMonitoringAvailable",
  ])
    host.method(CLASS, true, name, () => 0);
  delegateAccessors(host, CLASS, delegates);
  for (const name of ["location", "heading"]) host.method(CLASS, false, name, () => 0);
  for (const name of [
    "setDesiredAccuracy:",
    "setDistanceFilter:",
    "setPurpose:",
    "setHeadingFilter:",
    "stopUpdatingLocation",
    "stopUpdatingHeading",
    "stopMonitoringSignificantLocationChanges",
    "requestWhenInUseAuthorization",
    "requestAlwaysAuthorization",
  ])
    host.method(CLASS, false, name, () => undefined);
  for (const name of [
    "startUpdatingLocation",
    "startMonitoringSignificantLocationChanges",
    "startUpdatingHeading",
  ])
    host.method(CLASS, false, name, (self) =>
      failLater(
        host,
        () => delegates.get(self) ?? 0,
        "locationManager:didFailWithError:",
        [self],
        () => host.error(CL_ERROR_DENIED, DOMAIN),
      ),
    );
  host.method(CLASS, false, "dealloc", (self) => {
    delegates.delete(self);
    host.destroy(self);
  });
}
