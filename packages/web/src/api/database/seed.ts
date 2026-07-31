import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "./index";
import { user as userTable } from "./schema";

async function resetAndCreateAdmin() {
  try {
    // 1. Tenta deletar se já existir para limpar o estado
    await db.delete(userTable).where(eq(userTable.email, "kiko@studiodaioakes.com"));

    // 2. Cria o usuário limpo via Better Auth (gerando o hash correto da senha)
    const user = await auth.api.signUpEmail({
      body: {
        email: "kiko@studiodaioakes.com",
        password: "DaianeOakes",
        name: "Kiko",
      },
    });

    // 3. Força a verificação do email imediatamente
    if (user) {
      await db.update(userTable)
        .set({ emailVerified: true })
        .where(eq(userTable.email, "kiko@studiodaioakes.com"));
      
      console.log("✅ Admin recriado e verificado com sucesso!");
      console.log("📧 Email: kiko@studiodaioakes.com");
      console.log("🔑 Senha: DaianeOakes");
    }
  } catch (error) {
    console.error("❌ Erro:", error);
  }
}

resetAndCreateAdmin();
