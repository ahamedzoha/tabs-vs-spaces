import { NextRequest, NextResponse } from "next/server";

// Server-side only (this route proxies the browser's vote to the API), so it
// does NOT need the NEXT_PUBLIC_ prefix that exposes a value to the browser.
const API_URL = process.env.API_URL || "http://localhost:3000";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const response = await fetch(`${API_URL}/votes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[vote route] Failed to proxy vote:", error);
    return NextResponse.json(
      { error: "Failed to submit vote" },
      { status: 502 },
    );
  }
}
