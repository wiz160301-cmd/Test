import { useState } from "react";
import { login } from "../lib/api";

interface Props {
  onLoggedIn: (userId: string) => void;
}

export function LoginForm({ onLoggedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const auth = await login(email, password);
      if (auth.role !== "technician") {
        setError("Ce compte n'a pas le rôle technicien.");
        return;
      }
      onLoggedIn(auth.user_id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <h1>IT Support Agent — Dashboard technicien</h1>
      {error && <p className="login-form__error">{error}</p>}
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="Mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit">Se connecter</button>
    </form>
  );
}
