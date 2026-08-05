import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Re:Taste" },
    { name: "description", content: "광주·전남 큐레이션 맛 지도" },
  ];
}

export default function Home() {
  return <Welcome message="광주·전남 큐레이션 맛 지도" />;
}
