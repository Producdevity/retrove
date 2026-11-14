export const SecurityStatus = {
  Success: 0,
  Unimplemented: -4,
  Parameter: -50,
  IO: -36,
  Duplicate: -25299,
  NotFound: -25300,
  Decode: -26275,
} as const;
export const SecurityKey = {
  Class: "class",
  Account: "acct",
  Service: "svce",
  Group: "agrp",
  Generic: "gena",
  Label: "labl",
  Description: "desc",
  Comment: "icmt",
  Data: "v_Data",
  ReturnData: "r_Data",
  ReturnAttributes: "r_Attributes",
  MatchLimit: "m_Limit",
} as const;
export const SecurityValue = {
  GenericPassword: "genp",
  One: "m_LimitOne",
  All: "m_LimitAll",
} as const;
export const KEYCHAIN_FILE = "/Library/retrove-keychain.plist";
export const SecuritySymbols = {
  _kSecClass: SecurityKey.Class,
  _kSecClassGenericPassword: SecurityValue.GenericPassword,
  _kSecAttrAccount: SecurityKey.Account,
  _kSecAttrService: SecurityKey.Service,
  _kSecAttrAccessGroup: SecurityKey.Group,
  _kSecAttrGeneric: SecurityKey.Generic,
  _kSecAttrLabel: SecurityKey.Label,
  _kSecAttrDescription: SecurityKey.Description,
  _kSecAttrComment: SecurityKey.Comment,
  _kSecValueData: SecurityKey.Data,
  _kSecReturnData: SecurityKey.ReturnData,
  _kSecReturnAttributes: SecurityKey.ReturnAttributes,
  _kSecMatchLimit: SecurityKey.MatchLimit,
  _kSecMatchLimitOne: SecurityValue.One,
  _kSecMatchLimitAll: SecurityValue.All,
} as const;
export const AttributeKeys = new Set<string>([
  SecurityKey.Class,
  SecurityKey.Account,
  SecurityKey.Service,
  SecurityKey.Group,
  SecurityKey.Generic,
  SecurityKey.Label,
  SecurityKey.Description,
  SecurityKey.Comment,
  SecurityKey.Data,
]);
