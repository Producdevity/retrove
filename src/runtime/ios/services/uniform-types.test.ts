import { describe, expect, it } from "vite-plus/test";
import { identifierForTag, preferredTag, TagClass } from "./uniform-types";

describe("uniform types", () => {
  it("maps extensions and MIME types to identifiers and back", () => {
    expect(identifierForTag(TagClass.FilenameExtension, "JPG")).toBe("public.jpeg");
    expect(identifierForTag(TagClass.MIMEType, "image/png")).toBe("public.png");
    expect(preferredTag("public.jpeg", TagClass.FilenameExtension)).toBe("jpg");
    expect(preferredTag("public.png", TagClass.MIMEType)).toBe("image/png");
  });
  it("gives unknown tags a dynamic identifier with no preferred tag", () => {
    expect(identifierForTag(TagClass.FilenameExtension, "xyz")).toBe("dyn.ext.xyz");
    expect(preferredTag("dyn.ext.xyz", TagClass.MIMEType)).toBeUndefined();
  });
});
