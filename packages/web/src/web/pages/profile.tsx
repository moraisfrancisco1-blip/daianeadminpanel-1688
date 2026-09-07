import { useRef, useState } from "react";
import { Protected } from "../components/protected";
import { authClient, useSession } from "../lib/auth-client";
import { User, Lock, Camera, Save, Loader2, ShieldCheck, ShieldOff, X } from "lucide-react";
import QRCode from "qrcode";

const AVATAR_SIZE = 256;

/** Resizes/crops an image file to a square JPEG data URL, so the stored profile photo stays small. */
function fileToSquareDataUrl(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () => {
      img.onerror = () => reject(new Error("Could not read the image."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported."));
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function ProfilePage() {
  return (
    <Protected>
      <ProfileContent />
    </Protected>
  );
}

function ProfileContent() {
  const { data: session, refetch } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(session?.user?.name ?? "");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [show2faSetup, setShow2faSetup] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [disableMsg, setDisableMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const currentName = session?.user?.name ?? "";
  const currentImage = (session?.user as { image?: string | null } | undefined)?.image ?? null;
  const initials = (currentName || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();

  async function saveName() {
    if (!name.trim() || name === currentName) return;
    setNameSaving(true);
    setNameMsg(null);
    try {
      await authClient.updateUser({ name: name.trim() });
      await refetch();
      setNameMsg("Saved.");
      setTimeout(() => setNameMsg(null), 2000);
    } catch {
      setNameMsg("Failed to save name.");
    } finally {
      setNameSaving(false);
    }
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const dataUrl = await fileToSquareDataUrl(file, AVATAR_SIZE);
      await authClient.updateUser({ image: dataUrl });
      await refetch();
    } catch (err: any) {
      setPhotoError(err?.message ?? "Failed to upload photo.");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function changePassword() {
    setPasswordMsg(null);
    if (!currentPassword || !newPassword) {
      setPasswordMsg({ ok: false, text: "Fill in both password fields." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: "New password and confirmation don't match." });
      return;
    }
    setPasswordSaving(true);
    try {
      const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (error) throw new Error(error.message ?? "Failed to change password.");
      setPasswordMsg({ ok: true, text: "Password changed." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordMsg({ ok: false, text: err?.message ?? "Failed to change password." });
    } finally {
      setPasswordSaving(false);
    }
  }

  const twoFactorEnabled = !!(session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled;

  async function disable2fa() {
    setDisableMsg(null);
    if (!disablePassword) {
      setDisableMsg({ ok: false, text: "Enter your password to disable two-factor authentication." });
      return;
    }
    setDisabling(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password: disablePassword });
      if (error) throw new Error(error.message ?? "Failed to disable two-factor authentication.");
      await refetch();
      setDisablePassword("");
      setDisableMsg({ ok: true, text: "Two-factor authentication disabled." });
    } catch (err: any) {
      setDisableMsg({ ok: false, text: err?.message ?? "Failed to disable two-factor authentication." });
    } finally {
      setDisabling(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-brand-teal">Profile</h1>
        <p className="text-muted-foreground mt-1">Your account details</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <User className="size-4 text-brand-copper" /> Photo &amp; name
        </h3>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative shrink-0 size-20 rounded-full overflow-hidden ring-2 ring-brand-gold/60 group"
            title="Change photo"
          >
            {currentImage ? (
              <img src={currentImage} alt={currentName} className="w-full h-full object-cover" />
            ) : (
              <span className="w-full h-full flex items-center justify-center bg-brand-teal text-white font-display text-xl">
                {initials}
              </span>
            )}
            <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              {photoUploading ? (
                <Loader2 className="size-5 text-white animate-spin" />
              ) : (
                <Camera className="size-5 text-white" />
              )}
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">Name</label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 h-10 px-3 rounded-md border border-input bg-background text-sm"
              />
              <button
                onClick={saveName}
                disabled={nameSaving || !name.trim() || name === currentName}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
              >
                <Save className="size-3.5" /> {nameSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {nameMsg && <p className="text-xs text-[#4C7A56]">{nameMsg}</p>}
            <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
          </div>
        </div>
        {photoError && <p className="text-sm text-destructive mt-3">{photoError}</p>}
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-medium mb-4 flex items-center gap-2">
          <Lock className="size-4 text-brand-copper" /> Change password
        </h3>
        <div className="space-y-3 max-w-sm">
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
          <button
            onClick={changePassword}
            disabled={passwordSaving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
          >
            {passwordSaving && <Loader2 className="size-3.5 animate-spin" />} Change password
          </button>
          {passwordMsg && (
            <p className={`text-sm ${passwordMsg.ok ? "text-[#4C7A56]" : "text-destructive"}`}>{passwordMsg.text}</p>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-medium mb-1 flex items-center gap-2">
          {twoFactorEnabled ? (
            <ShieldCheck className="size-4 text-[#4C7A56]" />
          ) : (
            <ShieldOff className="size-4 text-brand-copper" />
          )}
          Two-factor authentication
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          {twoFactorEnabled
            ? "Enabled — a code from your authenticator app is required at every sign-in."
            : "Adds a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password, etc.)."}
        </p>
        {twoFactorEnabled ? (
          <div className="space-y-2 max-w-sm">
            <input
              type="password"
              placeholder="Current password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
            <button
              onClick={disable2fa}
              disabled={disabling}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-destructive text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {disabling && <Loader2 className="size-3.5 animate-spin" />} Disable two-factor authentication
            </button>
            {disableMsg && (
              <p className={`text-sm ${disableMsg.ok ? "text-[#4C7A56]" : "text-destructive"}`}>{disableMsg.text}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => setShow2faSetup(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
          >
            <ShieldCheck className="size-4" /> Enable two-factor authentication
          </button>
        )}
      </div>

      {show2faSetup && (
        <TwoFactorSetupModal
          onClose={() => setShow2faSetup(false)}
          onEnabled={() => {
            setShow2faSetup(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

function TwoFactorSetupModal(props: { onClose: () => void; onEnabled: () => void }) {
  const { onClose, onEnabled } = props;
  const [step, setStep] = useState<"password" | "scan" | "confirm">("password");
  const [password, setPassword] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const manualSecret = (() => {
    try {
      return new URL(totpUri).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  })();

  async function startEnable() {
    setError("");
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) throw new Error(error.message ?? "Failed to start two-factor setup.");
      const uri = (data as { totpURI?: string })?.totpURI ?? "";
      const codes = (data as { backupCodes?: string[] })?.backupCodes ?? [];
      setTotpUri(uri);
      setBackupCodes(codes);
      setQrDataUrl(uri ? await QRCode.toDataURL(uri, { width: 220 }) : "");
      setStep("scan");
    } catch (err: any) {
      setError(err?.message ?? "Failed to start two-factor setup.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    setError("");
    if (!code) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) throw new Error(error.message ?? "Invalid code — check the app and try again.");
      onEnabled();
    } catch (err: any) {
      setError(err?.message ?? "Invalid code — check the app and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-xl p-6 w-full max-w-sm space-y-4 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground">
          <X className="size-4" />
        </button>
        <h2 className="font-display text-xl font-semibold">Enable two-factor authentication</h2>

        {step === "password" && (
          <>
            <p className="text-sm text-muted-foreground">Confirm your password to continue.</p>
            <input
              type="password"
              placeholder="Current password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={startEnable}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="size-4 animate-spin" />} Continue
            </button>
          </>
        )}

        {step === "scan" && (
          <>
            <p className="text-sm text-muted-foreground">
              Scan this with your authenticator app (Google Authenticator, Authy, 1Password, etc.), or enter the code manually.
            </p>
            {qrDataUrl && <img src={qrDataUrl} alt="Two-factor QR code" className="mx-auto rounded-md border border-border" />}
            {manualSecret && (
              <p className="text-xs text-center text-muted-foreground break-all font-mono bg-secondary/50 rounded-md px-2 py-1.5">
                {manualSecret}
              </p>
            )}
            <div className="bg-secondary/40 rounded-md p-3">
              <p className="text-xs font-medium mb-1.5">Backup codes — save these somewhere safe</p>
              <p className="text-xs text-muted-foreground mb-2">
                Use one of these to sign in if you ever lose access to your authenticator app. Each works once.
              </p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                {backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </div>
            <button
              onClick={() => setStep("confirm")}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
            >
              I've saved these — continue
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <p className="text-sm text-muted-foreground">Enter the 6-digit code from your app to confirm it's working.</p>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm tracking-widest text-center"
              placeholder="123456"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              onClick={confirmCode}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="size-4 animate-spin" />} Confirm and enable
            </button>
          </>
        )}
      </div>
    </div>
  );
}
