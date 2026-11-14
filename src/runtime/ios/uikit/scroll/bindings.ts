import { floatBits, floatFromBits, GeometryField, WORD_BYTES } from "../../abi/scalars";
import { structureMethod } from "../host";
import { SCROLL_CLASS, ScrollViews, type ScrollHost, type Point, type Insets } from "./state";
import { ScrollInteraction } from "./interaction";
const ScrollArgument = { AnimatedPoint: 2, AnimatedRect: 4 } as const;
const INSET_FIELDS = 4;
const MILLISECONDS_PER_SECOND = 1000;
const NUMBER_FIELDS = 2;
function installGeometry(host: ScrollHost, views: ScrollViews): void {
  const point = (args: (index: number) => number): Point => [
    floatFromBits(args(0)),
    floatFromBits(args(1)),
  ];
  host.structure(
    SCROLL_CLASS,
    false,
    "contentOffset",
    structureMethod((self, _, out) => {
      views
        .offset(self)
        .forEach((value, index) => host.write(out + index * WORD_BYTES, floatBits(value)));
    }),
  );
  host.structure(
    SCROLL_CLASS,
    false,
    "contentSize",
    structureMethod((self, _, out) => {
      views
        .get(self)
        .size.forEach((value, index) => host.write(out + index * WORD_BYTES, floatBits(value)));
    }),
  );
  host.method(SCROLL_CLASS, false, "setContentSize:", (self, args) => {
    const size = point(args);
    if (!size.every((value) => Number.isFinite(value) && value >= 0))
      throw new Error("Invalid UIScrollView content size.");
    views.get(self).size = size;
  });
  host.method(SCROLL_CLASS, false, "setContentOffset:", (self, args) =>
    views.setOffset(self, point(args)),
  );
  host.method(SCROLL_CLASS, false, "setContentOffset:animated:", (self, args) =>
    views.setOffset(self, point(args), Boolean(args(ScrollArgument.AnimatedPoint))),
  );
  host.method(SCROLL_CLASS, false, "scrollRectToVisible:animated:", (self, args) =>
    views.setOffset(
      self,
      views.visible(self, [
        floatFromBits(args(GeometryField.X)),
        floatFromBits(args(GeometryField.Y)),
        floatFromBits(args(GeometryField.Width)),
        floatFromBits(args(GeometryField.Height)),
      ]),
      Boolean(args(ScrollArgument.AnimatedRect)),
    ),
  );
  for (const [getter, setter, key] of [
    ["contentInset", "setContentInset:", "inset"],
    ["scrollIndicatorInsets", "setScrollIndicatorInsets:", "indicatorInsets"],
  ] as const) {
    host.structure(
      SCROLL_CLASS,
      false,
      getter,
      structureMethod((self, _, out) =>
        views
          .get(self)
          [key].forEach((value, index) => host.write(out + index * WORD_BYTES, floatBits(value))),
      ),
    );
    host.method(SCROLL_CLASS, false, setter, (self, args) => {
      const values: Insets = [
        floatFromBits(args(0)),
        floatFromBits(args(1)),
        floatFromBits(args(NUMBER_FIELDS)),
        floatFromBits(args(INSET_FIELDS - 1)),
      ];
      if (!values.every(Number.isFinite)) throw new Error("Invalid UIScrollView insets.");
      views.get(self)[key] = values;
    });
  }
}
function installProperties(host: ScrollHost, views: ScrollViews): void {
  for (const [getter, setter, key] of [
    ["isScrollEnabled", "setScrollEnabled:", "enabled"],
    ["scrollsToTop", "setScrollsToTop:", "scrollsToTop"],
    ["isPagingEnabled", "setPagingEnabled:", "paging"],
    ["bounces", "setBounces:", "bounces"],
    ["alwaysBounceHorizontal", "setAlwaysBounceHorizontal:", "horizontalBounce"],
    ["alwaysBounceVertical", "setAlwaysBounceVertical:", "verticalBounce"],
    ["isDirectionalLockEnabled", "setDirectionalLockEnabled:", "directional"],
    ["canCancelContentTouches", "setCanCancelContentTouches:", "cancelTouches"],
    ["delaysContentTouches", "setDelaysContentTouches:", "delayTouches"],
    ["showsHorizontalScrollIndicator", "setShowsHorizontalScrollIndicator:", "horizontalIndicator"],
    ["showsVerticalScrollIndicator", "setShowsVerticalScrollIndicator:", "verticalIndicator"],
  ] as const) {
    host.method(SCROLL_CLASS, false, getter, (self) => Number(views.get(self)[key]));
    host.method(SCROLL_CLASS, false, setter, (self, args) => {
      views.get(self)[key] = Boolean(args(0));
    });
  }
  for (const getter of ["isDragging", "isDecelerating"] as const)
    host.method(SCROLL_CLASS, false, getter, (self) =>
      Number(views.get(self)[getter === "isDragging" ? "dragging" : "decelerating"]),
    );
  host.method(SCROLL_CLASS, false, "delegate", (self) => views.get(self).delegate);
  host.method(SCROLL_CLASS, false, "setDelegate:", (self, args) => {
    views.get(self).delegate = args(0);
  });
  host.method(SCROLL_CLASS, false, "indicatorStyle", (self) => views.get(self).indicatorStyle);
  host.method(SCROLL_CLASS, false, "setIndicatorStyle:", (self, args) => {
    views.get(self).indicatorStyle = args(0);
  });
  host.method(SCROLL_CLASS, false, "decelerationRate", (self) => floatBits(views.get(self).rate));
  host.method(SCROLL_CLASS, false, "setDecelerationRate:", (self, args) => {
    const value = floatFromBits(args(0));
    if (!(value > 0 && value < 1)) throw new Error("Invalid UIScrollView deceleration rate.");
    views.get(self).rate = value;
  });
  host.method(SCROLL_CLASS, false, "flashScrollIndicators", (self) => {
    views.get(self).flashUntil = host.now() + MILLISECONDS_PER_SECOND;
  });
}
export function installScrollViews(host: ScrollHost) {
  host.hostClass(SCROLL_CLASS, "UIView");
  const views = new ScrollViews(host),
    interaction = new ScrollInteraction(views);
  host.method(SCROLL_CLASS, false, "init", (self) => {
    views.get(self);
    return self;
  });
  host.method(SCROLL_CLASS, false, "initWithFrame:", (self, args) => {
    views.get(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      floatFromBits(args(GeometryField.Width)),
      floatFromBits(args(GeometryField.Height)),
    ]);
  });
  host.method(SCROLL_CLASS, false, "dealloc", async (self) => {
    views.states.delete(self);
    await host.deallocateView(self);
  });
  installGeometry(host, views);
  installProperties(host, views);
  let previous = host.now();
  return {
    views,
    interaction,
    pump: async () => {
      const now = host.now();
      await views.pump(now - previous);
      previous = now;
    },
    close: () => {
      interaction.close();
      views.states.clear();
    },
  };
}
