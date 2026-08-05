import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("admin/places", "routes/admin-places.tsx"),
  route("admin/import", "routes/admin-import.tsx"),
] satisfies RouteConfig;
