import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { url, options } = await request.json();

    if (!url) {
      return NextResponse.json({ success: false, error: "URL is required" }, { status: 400 });
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ 
        success: false, 
        error: `API responded with status ${response.status}: ${errorText}` 
      }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}