import Scanner from "./Scanner";

export default function Home() {
  return (
    <main className="wrap">
      <Scanner />
      <p className="note">
        The bot only sends alerts and webhooks, it never places orders by itself. Trading
        forex and gold is risky and this is not financial advice.
      </p>
    </main>
  );
}
