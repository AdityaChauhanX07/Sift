import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sift — forensic shopping",
  description:
    "Sift investigates every listing for your query, kills the traps — fake reviews, ghost sellers, drop-ship markups — and shows you only the deals worth trusting.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Sift design fonts — Archivo (display) + JetBrains Mono.
            Loaded via <link> rather than next/font so sift.css can keep
            referencing the literal "Archivo" / "JetBrains Mono" family names. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- needed so
            sift.css can reference the literal "Archivo"/"JetBrains Mono" names;
            next/font would rewrite them to hashed family names. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* sift.css styles the <body> element directly (background, font, grid). */}
      <body>{children}</body>
    </html>
  );
}
