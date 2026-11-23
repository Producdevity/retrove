import { Argument } from "../../objc/host";
import { NOTIFICATION_BYTES, NOTIFICATION_FIELDS, NotificationField } from "./constants";
import type { FoundationContext } from "./types";
import { readString } from "../../../memory/guest-memory";

const CENTER = "NSNotificationCenter";
const NOTIFICATION = "NSNotification";
interface Observer {
  observer: number;
  sel: number;
  name: string | null;
  sender: number;
}

export function installNotifications(ctx: FoundationContext): void {
  const { method, hostClass, h, text, read, write, retain, release, autorelease, send } = ctx;
  hostClass(CENTER, "NSObject");
  hostClass(NOTIFICATION, "NSObject", NOTIFICATION_BYTES);
  const observers: Observer[] = [];
  method(CENTER, true, "defaultCenter", h.singleton(CENTER));
  method(CENTER, false, "addObserver:selector:name:object:", (_, args) => {
    observers.push({
      observer: args(0),
      sel: args(1),
      name: args(Argument.Third) ? text(args(Argument.Third)) : null,
      sender: args(Argument.Fourth),
    });
  });
  const remove = (args: (index: number) => number, filtering: boolean): void => {
    const name = filtering && args(1) ? text(args(1)) : null;
    const sender = filtering ? args(Argument.Third) : 0;
    for (let index = observers.length - 1; index >= 0; index--) {
      const entry = observers[index];
      if (!entry) continue;
      if (
        entry.observer === args(0) &&
        (!name || entry.name === name) &&
        (!sender || entry.sender === sender)
      ) {
        observers.splice(index, 1);
      }
    }
  };
  method(CENTER, false, "removeObserver:", (_, args) => {
    remove(args, false);
  });
  method(CENTER, false, "removeObserver:name:object:", (_, args) => {
    remove(args, true);
  });
  const notification = (name: number, sender: number, userInfo: number): number => {
    const pointer = ctx.alloc(h.classPointer(NOTIFICATION));
    write(pointer + NotificationField.Name, retain(name));
    write(pointer + NotificationField.Sender, retain(sender));
    write(pointer + NotificationField.UserInfo, retain(userInfo));
    return autorelease(pointer);
  };
  const post = async (pointer: number): Promise<void> => {
    const name = text(read(pointer + NotificationField.Name));
    const sender = read(pointer + NotificationField.Sender);
    for (const entry of [...observers]) {
      if (
        (entry.name === null || entry.name === name) &&
        (!entry.sender || entry.sender === sender)
      ) {
        await send(entry.observer, readString(ctx.cpu, entry.sel), [pointer]);
      }
    }
  };
  method(NOTIFICATION, true, "notificationWithName:object:", (_, args) =>
    notification(args(0), args(1), 0),
  );
  method(NOTIFICATION, true, "notificationWithName:object:userInfo:", (_, args) =>
    notification(args(0), args(1), args(Argument.Third)),
  );
  for (const [name, offset] of [
    ["name", NotificationField.Name],
    ["object", NotificationField.Sender],
    ["userInfo", NotificationField.UserInfo],
  ] as const) {
    method(NOTIFICATION, false, name, (self) => read(self + offset));
  }
  method(NOTIFICATION, false, "dealloc", async (self) => {
    for (const offset of NOTIFICATION_FIELDS) await release(read(self + offset));
    ctx.destroy(self);
  });
  method(CENTER, false, "postNotification:", (_, args) => post(args(0)));
  method(CENTER, false, "postNotificationName:object:", (_, args) =>
    post(notification(args(0), args(1), 0)),
  );
  method(CENTER, false, "postNotificationName:object:userInfo:", (_, args) =>
    post(notification(args(0), args(1), args(Argument.Third))),
  );
}
