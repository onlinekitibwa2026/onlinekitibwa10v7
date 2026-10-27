import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ONLINE KITIBWA | AI Forex Trading",
  description: "Demo dashboard for the ONLINE KITIBWA forex bot",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0a0a" };

// Sets the saved colour design before the page paints, so it never flashes the wrong colours
const THEME_JS = `try{var t=localStorage.getItem("kitibwa.theme.v1");if(t==="ocean"||t==="royal"||t==="noir")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="noir" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_JS }} /></head>
      <body>{children}</body>
    </html>
  );
}
