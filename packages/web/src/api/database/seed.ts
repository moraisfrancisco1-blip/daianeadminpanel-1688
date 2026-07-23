import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "./index";
import { user as userTable } from "./schema";

async function resetAndCreateAdmin() {
  try {
    // 1. Tenta deletar se já existir para limpar o estado
    await db.delete(userTable).where(eq(userTable.email, "admin@studiodaioakes.com"));

    // 2. Cria o usuário limpo via Better Auth (gerando o hash correto da senha)
    const user = await auth.api.signUpEmail({
      body: {
        email: "admn@studiodaioakes.com",
        password: "DaianeOakes",
        name: "Daiane",
      },
    });

    // 3. Força a verificação do email imediatamente
    if (user) {
      await db.update(userTable)
        .set({ emailVerified: true })
        .where(eq(userTable.email, "admin2@studiodaioakes.com"));
      
      console.log("✅ Admin recriado e verificado com sucesso!");
    }
  } catch (error) {
    console.error("❌ Erro:", error);
  }
}

resetAndCreateAdmin();