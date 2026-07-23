import { initPlasmicLoader } from "@plasmicapp/loader-react";

export const PLASMIC = initPlasmicLoader({
  projects: [
    {
      id: "pChTiY8JbNF1p4Viu1U6co", // Cole aqui o ID do seu projeto do Plasmic
      token: "SEU_API_TOKEN", // Cole aqui o token público do seu projeto
    },
  ],
  preview: true,
});