export enum API {
  LOGIN = "/api/auth/login",
  SIGNUP = "/api/auth/signup",
  RENEW = "/api/auth/renew",
  REPORT = "/api/url/report",
  RESET_PASSWORD = "/api/auth/resetpassword",
  CHANGE_PASSWORD = "/api/auth/changepassword",
  BAN_LINK = "/api/url/admin/ban",
  CUSTOM_DOMAIN = "/api/url/customdomain",
  GENERATE_APIKEY = "/api/auth/generateapikey",
  SETTINGS = "/api/auth/usersettings",
  SUBMIT = "/api/url/submit",
  GET_LINKS = "/api/url/geturls",
  DELETE_LINK = "/api/url/deleteurl",
  STATS = "/api/url/stats"
}

export enum APIv2 {
  Links = "/api/v2/links"
}

export enum Colors {
  Text = "hsl(200, 35%, 25%)",
  Bg = "hsl(206, 12%, 95%)",
  Spinner = "hsl(200, 15%, 70%)",
  FeaturesBg = "hsl(230, 15%, 92%)",
  ExtensionsBg = "hsl(230, 15%, 20%)",
  Icon = "hsl(200, 35%, 45%)",
  IconShadow = "hsla(200, 15%, 60%, 0.12)",
  CopyIcon = "hsl(144, 40%, 57%)",
  CopyIconBg = "hsl(144, 100%, 96%)",
  CheckIcon = "hsl(144, 50%, 60%)",
  TrashIcon = "hsl(0, 100%, 69%)",
  TrashIconBg = "hsl(0, 100%, 96%)",
  QrCodeIcon = "hsl(0, 0%, 35%)",
  QrCodeIconBg = "hsl(0, 0%, 94%)",
  PieIcon = "hsl(260, 100%, 69%)",
  PieIconBg = "hsl(260, 100%, 96%)",
  TableHeadBg = "hsl(200, 12%, 95%)",
  TableHeadBorder = "hsl(200, 14%, 94%)",
  TableBorder = "hsl(200, 14%, 90%)",
  TableRowHover = "hsl(200, 14%, 98%)",
  TableShadow = "hsla(200, 20%, 70%, 0.3)",
  StatsLastUpdateText = "hsl(200, 14%, 60%)",
  StatsTotalUnderline = "hsl(200, 35%, 65%)",
  Divider = "hsl(200, 20%, 92%)"
}
