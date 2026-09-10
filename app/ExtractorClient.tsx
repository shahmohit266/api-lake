"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { signOut } from "next-auth/react";

interface ExtractorProps {
  userEmail: string;
}

export default function ExtractorClient({ userEmail }: ExtractorProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePresetName, setActivePresetName] = useState("");
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<any[]>([]);
  const [banner, setBanner] = useState({ show: false, mode: "", text: "", targetId: null as string | null });
  
  const [activeTab, setActiveTab] = useState<"config" | "preview">("config");
  const [previewData, setPreviewData] = useState<any[]>([]);
  
  const [endpoint, setEndpoint] = useState("https://datalakeapi.pathfactory.com/public/v3/pageviews/");
  const [method, setMethod] = useState("GET");
  const [reqBody, setReqBody] = useState("");
  const [params, setParams] = useState([{ key: "v1format", value: "false" }]);
  const [headers, setHeaders] = useState([{ key: "Authorization", value: "" }]);
  
  const [offsetKey, setOffsetKey] = useState("offset");
  const [limitKey, setLimitKey] = useState("limit");
  const [limitVal, setLimitVal] = useState("1000");
  const [startOffset, setStartOffset] = useState("0");
  const [stepType, setStepType] = useState("limit");
  const [maxRequests, setMaxRequests] = useState("50");
  const [delayMs, setDelayMs] = useState("300");
  const [dataPath, setDataPath] = useState("");
  
  const [status, setStatus] = useState("Ready to configure");
  const [isRunning, setIsRunning] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    const { data } = await supabase.from('saved_queries').select('*').order('created_at', { ascending: false });
    if (data) setSavedPresets(data);
  };

  const handleClear = () => {
    setActiveId(null);
    setActivePresetName("");
    setPresetName("");
    setEndpoint("https://api/endpoint/");
    setMethod("GET");
    setParams([{ key: "", value: "" }]);
    setHeaders([{ key: "Authorization", value: "" }]);
    setPreviewData([]);
    setStatus("Started a new blank configuration.");
  };

  const loadPreset = (p: any) => {
    setActiveId(p.id);
    setActivePresetName(p.name);
    setPresetName(p.name);
    setEndpoint(p.endpoint || "");
    setMethod(p.method || "GET");
    
    const pHeaders = Object.keys(p.headers || {}).map(k => ({ key: k, value: p.headers[k] }));
    setHeaders(pHeaders.length ? pHeaders : [{ key: "", value: "" }]);
    
    const pParams = Object.keys(p.params || {}).map(k => ({ key: k, value: p.params[k] }));
    setParams(pParams.length ? pParams : [{ key: "", value: "" }]);
    
    const pag = p.pagination || {};
    setOffsetKey(pag.offsetKey || "offset");
    setLimitKey(pag.limitKey || "limit");
    setLimitVal(pag.limitVal || "1000");
    setStartOffset(pag.startOffset || "0");
    setStepType(pag.stepType || "limit");
    setDataPath(pag.dataPath || "");
    setMaxRequests(pag.maxRequests || "50");
    setDelayMs(pag.delayMs || "300");
    
    setStatus(`Loaded preset: ${p.name}`);
  };

  const triggerBanner = (mode: string, overrideId?: string, overrideName?: string) => {
    const targetName = overrideName || presetName;
    const targetId = overrideId || activeId;
    
    if (mode !== "delete" && !targetName) return setStatus("Error: Please enter a preset name.");
    if (mode === "delete" && !targetId) return setStatus("Error: No preset selected.");
    
    const messages = {
      save: `Update existing preset "${targetName}"?`,
      saveAs: `Create new preset "${targetName}"?`,
      delete: `Permanently delete "${targetName}"?`
    };
    setBanner({ show: true, mode, text: messages[mode as keyof typeof messages], targetId });
  };

  const confirmAction = async () => {
    setBanner({ show: false, mode: "", text: "", targetId: null });
    setStatus("Processing database request...");

    const payload = {
      user_email: userEmail,
      name: presetName,
      endpoint,
      method,
      headers: headers.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {}),
      params: params.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {}),
      pagination: { offsetKey, limitKey, limitVal, startOffset, stepType, dataPath, maxRequests, delayMs }
    };

    try {
      if (banner.mode === "save" && activeId) {
        const { error } = await supabase.from('saved_queries').update(payload).eq('id', activeId);
        if (error) throw error;
        setActivePresetName(presetName);
      } else if (banner.mode === "save" || banner.mode === "saveAs") {
        const { data, error } = await supabase.from('saved_queries').insert([payload]).select();
        if (error) throw error;
        if (data && data[0]) {
          setActiveId(data[0].id);
          setActivePresetName(data[0].name);
        }
      } else if (banner.mode === "delete") {
        const { error } = await supabase.from('saved_queries').delete().eq('id', banner.targetId);
        if (error) throw error;
        if (banner.targetId === activeId) handleClear();
      }
      setStatus("Success! Database operation complete.");
      fetchPresets();
    } catch (err: any) {
      setStatus(`Database Error: ${err.message}`);
    }
  };

  const addField = (setter: any, state: any) => setter([...state, { key: "", value: "" }]);
  const updateField = (setter: any, state: any, i: number, field: string, val: string) => {
    const updated = [...state]; updated[i][field] = val; setter(updated);
  };

  const handlePreview = async () => {
    setStatus("Fetching preview batch...");
    try {
      const url = new URL(endpoint);
      const cleanParams = params.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {});
      const cleanHeaders = headers.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {});

      if (limitKey && parseInt(limitVal) > 0) url.searchParams.set(limitKey, "5");
      if (offsetKey) url.searchParams.set(offsetKey, startOffset);
      Object.keys(cleanParams).forEach(k => url.searchParams.set(k, cleanParams[k]));

      const options: any = { method, headers: cleanHeaders };
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.toString(), options })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      const records = dataPath 
        ? dataPath.split('.').reduce((acc: any, part: string) => acc && acc[part], result.data) 
        : result.data;

      if (Array.isArray(records)) {
        setPreviewData(records.slice(0, 5));
        setActiveTab("preview");
        setStatus(`Preview loaded successfully (${records.length} items found in response).`);
      } else {
        setStatus("Error: Response data is not an array. Check your JSON Array Path.");
      }
    } catch (err: any) {
      setStatus(`Preview Error: ${err.message}`);
    }
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const handleExtract = async () => {
    setStatus("Extracting data... please wait.");
    setIsRunning(true);
    stopRef.current = false;
    
    let currentOffset = parseInt(startOffset, 10) || 0;
    const parsedLimit = parseInt(limitVal, 10) || 0;
    const max = parseInt(maxRequests, 10) || 50;
    const delay = parseInt(delayMs, 10) || 0;
    
    let allRecords: any[] = [];
    let requestCount = 0;

    const cleanParams = params.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {});
    const cleanHeaders = headers.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {});

    try {
      while (!stopRef.current && requestCount < max) {
        requestCount++;
        const url = new URL(endpoint);
        
        if (limitKey && parsedLimit > 0) url.searchParams.set(limitKey, parsedLimit.toString());
        if (offsetKey) url.searchParams.set(offsetKey, currentOffset.toString());
        Object.keys(cleanParams).forEach(key => url.searchParams.set(key, cleanParams[key]));

        const options: any = { method, headers: cleanHeaders };
        if (['POST', 'PUT', 'PATCH'].includes(method) && reqBody) {
          options.body = reqBody;
          if (!options.headers['Content-Type']) options.headers['Content-Type'] = 'application/json';
        }

        setStatus(`[Request #${requestCount}] Fetching offset=${currentOffset}... (Total records: ${allRecords.length})`);

        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.toString(), options })
        });
        
        const result = await res.json();
        if (!result.success) throw new Error(result.error);
        
        const records = dataPath 
          ? dataPath.split('.').reduce((acc: any, part: string) => acc && acc[part], result.data) 
          : result.data;
        
        if (!Array.isArray(records) || records.length === 0) break;
        
        allRecords = allRecords.concat(records);
        if (parsedLimit > 0 && records.length < parsedLimit) break;
        
        currentOffset += stepType === 'limit' ? parsedLimit : 1;
        if (delay > 0 && !stopRef.current) await sleep(delay);
      }

      if (allRecords.length > 0) {
        const csvHeaders = Object.keys(allRecords[0]).join(",");
        const rows = allRecords.map((row: any) => Object.values(row).map(val => `"${val}"`).join(",")).join("\n");
        const blob = new Blob([`${csvHeaders}\n${rows}`], { type: "text/csv" });
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl; a.download = "api_export.csv"; a.click();
        setStatus(`Successfully downloaded ${allRecords.length} records.`);
      } else {
        setStatus(`Finished. No data found.`);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}. Downloaded ${allRecords.length} partial records.`);
    }
    setIsRunning(false);
  };

  const handleStop = () => {
    stopRef.current = true;
    setStatus("Stopping loop after current batch finishes...");
  };

  const Label = ({ text }: { text: string }) => <label style={{ display: "block", fontSize: "11px", color: "#94a3b8", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{text}</label>;
  const inputStyle = { width: "100%", padding: "10px 12px", background: "#0b1120", color: "#fff", border: "1px solid #334155", borderRadius: "6px", fontSize: "14px", outline: "none" };

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f8fafc", display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      
      {/* Top Header */}
      <header style={{ height: "65px", borderBottom: "1px solid #334155", background: "#1e293b", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <h1 style={{ fontSize: "1.1rem", color: "#f8fafc", fontWeight: "700" }}>API Data Extraction Suite</h1>
          {activePresetName && (
            <span style={{ fontSize: "12px", background: "#0284c7", color: "#fff", padding: "3px 8px", borderRadius: "12px", fontWeight: "600" }}>
              Active: {activePresetName} {presetName !== activePresetName && "• (Modified)"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "13px", color: "#94a3b8" }}>{userEmail}</span>
          <button onClick={() => signOut()} style={{ background: "transparent", color: "#ef4444", border: "1px solid #ef4444", padding: "6px 12px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", fontWeight: "600" }}>
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div style={{ display: "flex", flex: 1, padding: "24px", gap: "24px", maxWidth: "1500px", width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        
        {/* Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", flexShrink: 0 }}>
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} style={{ background: "#1e293b", border: "1px solid #334155", color: "#38bdf8", padding: "10px 14px", borderRadius: "8px", cursor: "pointer", fontWeight: "600", fontSize: "13px", textAlign: "left" }}>
            {isSidebarOpen ? "◀ Hide Presets" : "▶ Show Presets"}
          </button>

          {isSidebarOpen && (
            <div style={{ width: "280px", background: "#1e293b", border: "1px solid #334155", borderRadius: "10px", padding: "16px", height: "fit-content" }}>
              <h3 style={{ fontSize: "12px", color: "#38bdf8", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "700" }}>Saved Presets</h3>
              {savedPresets.length === 0 && <p style={{ fontSize: "13px", color: "#94a3b8" }}>No saved configurations found.</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {savedPresets.map(p => (
                  <div key={p.id} style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => loadPreset(p)} style={{ flex: 1, textAlign: "left", background: activeId === p.id ? "#334155" : "#0f172a", border: "1px solid #334155", color: "#fff", padding: "10px", borderRadius: "6px", cursor: "pointer", fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}
                    </button>
                    <button onClick={() => triggerBanner("delete", p.id, p.name)} style={{ background: "transparent", color: "#ef4444", border: "1px solid #ef4444", padding: "8px 10px", borderRadius: "6px", cursor: "pointer" }} title="Delete">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
          
          {/* Preset Controls Bar */}
          <div style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "10px", display: "flex", gap: "15px", alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <Label text="Preset Name" />
              <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="e.g. PathFactory Pageviews Q3" style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: "10px", flexShrink: 0 }}>
              <button onClick={handleClear} style={{ background: "#475569", color: "#fff", padding: "10px 16px", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "13px" }}>+ New</button>
              <button onClick={() => triggerBanner("save")} style={{ background: "#22c55e", color: "#000", padding: "10px 16px", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "13px" }}>Save</button>
              {activeId && (
                <>
                  <button onClick={() => triggerBanner("saveAs")} style={{ background: "#38bdf8", color: "#000", padding: "10px 16px", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "13px" }}>Save As Copy</button>
                  <button onClick={() => triggerBanner("delete")} style={{ background: "#ef4444", color: "#fff", padding: "10px 16px", border: "none", borderRadius: "6px", fontWeight: "600", cursor: "pointer", fontSize: "13px" }}>Delete</button>
                </>
              )}
            </div>
          </div>

          {/* Navigation Tabs */}
          <div style={{ display: "flex", gap: "10px", borderBottom: "1px solid #334155", paddingBottom: "10px" }}>
            <button onClick={() => setActiveTab("config")} style={{ background: activeTab === "config" ? "#38bdf8" : "#1e293b", color: activeTab === "config" ? "#000" : "#fff", padding: "8px 16px", borderRadius: "6px", border: "none", fontWeight: "bold", cursor: "pointer", fontSize: "13px" }}>
              Configuration Builder
            </button>
            <button onClick={handlePreview} style={{ background: activeTab === "preview" ? "#38bdf8" : "#1e293b", color: activeTab === "preview" ? "#000" : "#fff", padding: "8px 16px", borderRadius: "6px", border: "none", fontWeight: "bold", cursor: "pointer", fontSize: "13px" }}>
              🔍 Test & Data Preview
            </button>
          </div>

          {/* Configuration Builder Tab */}
          {activeTab === "config" && (
            <>
              <div style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "10px" }}>
                <h2 style={{ fontSize: "14px", color: "#38bdf8", marginBottom: "15px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>Target Endpoint & Authentication</h2>
                <div style={{ marginBottom: "16px" }}>
                  <Label text="URL & Method" />
                  <div style={{ display: "flex", gap: "10px" }}>
                    <select value={method} onChange={e => setMethod(e.target.value)} style={{ ...inputStyle, width: "120px", flexShrink: 0 }}>
                      <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
                    </select>
                    <input value={endpoint} onChange={e => setEndpoint(e.target.value)} style={inputStyle} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <Label text="Query Parameters" />
                      <button onClick={() => addField(setParams, params)} style={{ background: "none", color: "#38bdf8", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>+ Add Param</button>
                    </div>
                    {params.map((p, i) => (
                      <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                        <input placeholder="Key" value={p.key} onChange={e => updateField(setParams, params, i, "key", e.target.value)} style={inputStyle} />
                        <input placeholder="Value" value={p.value} onChange={e => updateField(setParams, params, i, "value", e.target.value)} style={inputStyle} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <Label text="Headers" />
                      <button onClick={() => addField(setHeaders, headers)} style={{ background: "none", color: "#38bdf8", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>+ Add Header</button>
                    </div>
                    {headers.map((h, i) => (
                      <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                        <input placeholder="Key" value={h.key} onChange={e => updateField(setHeaders, headers, i, "key", e.target.value)} style={inputStyle} />
                        <input placeholder="Value" value={h.value} onChange={e => updateField(setHeaders, headers, i, "value", e.target.value)} style={inputStyle} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "10px" }}>
                <h2 style={{ fontSize: "14px", color: "#38bdf8", marginBottom: "15px", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.5px" }}>Pagination & Loop Engine</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "15px", marginBottom: "15px" }}>
                  <div><Label text="Offset Param Name" /><input value={offsetKey} onChange={e => setOffsetKey(e.target.value)} style={inputStyle} /></div>
                  <div><Label text="Limit Param Name" /><input value={limitKey} onChange={e => setLimitKey(e.target.value)} style={inputStyle} /></div>
                  <div><Label text="Limit Value" /><input value={limitVal} onChange={e => setLimitVal(e.target.value)} type="number" style={inputStyle} /></div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "15px" }}>
                  <div><Label text="Start Offset" /><input value={startOffset} onChange={e => setStartOffset(e.target.value)} type="number" style={inputStyle} /></div>
                  <div>
                    <Label text="Increment Logic" />
                    <select value={stepType} onChange={e => setStepType(e.target.value)} style={inputStyle}>
                      <option value="limit">Add Limit (+1000)</option>
                      <option value="single">Add +1 (1, 2, 3)</option>
                    </select>
                  </div>
                  <div><Label text="Delay (ms)" /><input value={delayMs} onChange={e => setDelayMs(e.target.value)} type="number" style={inputStyle} /></div>
                  <div><Label text="JSON Array Path" /><input placeholder="e.g. data.items" value={dataPath} onChange={e => setDataPath(e.target.value)} style={inputStyle} /></div>
                </div>
              </div>
            </>
          )}

          {/* Live Data Preview Tab */}
          {activeTab === "preview" && (
            <div style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "10px" }}>
              <h2 style={{ fontSize: "14px", color: "#38bdf8", marginBottom: "15px", fontWeight: "700", textTransform: "uppercase" }}>Response Data Preview (All Columns)</h2>
              {previewData.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: "13px" }}>No preview data loaded yet. Click <strong>Test & Data Preview</strong> above to test your endpoint.</p>
              ) : (
                <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#0b1120", textAlign: "left", borderBottom: "1px solid #334155" }}>
                        {Object.keys(previewData[0] || {}).map((col, idx) => (
                          <th key={idx} style={{ padding: "10px", color: "#38bdf8", whiteSpace: "nowrap" }}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, rIdx) => (
                        <tr key={rIdx} style={{ borderBottom: "1px solid #334155" }}>
                          {Object.keys(previewData[0] || {}).map((col, cIdx) => (
                            <td key={cIdx} style={{ padding: "10px", color: "#cbd5e1", maxWidth: "250px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row[col] !== undefined && row[col] !== null ? String(row[col]) : ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Execution Controls & Logs */}
          <div style={{ background: "#1e293b", border: "1px solid #334155", padding: "20px", borderRadius: "10px" }}>
            <div style={{ display: "flex", gap: "15px", marginBottom: "15px" }}>
              {!isRunning ? (
                <button onClick={handleExtract} style={{ flex: 1, background: "#38bdf8", color: "#000", padding: "12px", border: "none", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "14px" }}>
                  Start Full Fetch & Download CSV
                </button>
              ) : (
                <button onClick={handleStop} style={{ flex: 1, background: "transparent", color: "#ef4444", border: "2px solid #ef4444", padding: "12px", borderRadius: "6px", fontWeight: "700", cursor: "pointer", fontSize: "14px" }}>
                  Terminate & Download Current Data
                </button>
              )}
            </div>
            <div style={{ background: "#0b1120", padding: "12px", borderRadius: "6px", fontFamily: "monospace", fontSize: "13px", color: "#a5f3fc", border: "1px solid #334155" }}>
              &gt; Status: {status}
            </div>
          </div>

        </div>
      </div>

      {/* Confirmation Modal Overlay */}
      {banner.show && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(4px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", padding: "25px", borderRadius: "10px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)", color: "#f8fafc" }}>
            <h3 style={{ fontSize: "16px", marginBottom: "12px", color: "#38bdf8", fontWeight: "700" }}>Please Confirm</h3>
            <p style={{ fontSize: "14px", marginBottom: "20px", color: "#cbd5e1" }}>{banner.text}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button onClick={() => setBanner({ show: false, mode: "", text: "", targetId: null })} style={{ background: "transparent", color: "#fff", border: "1px solid #334155", padding: "8px 16px", borderRadius: "6px", cursor: "pointer", fontSize: "13px" }}>Cancel</button>
              <button onClick={confirmAction} style={{ background: "#38bdf8", color: "#000", padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontWeight: "700", fontSize: "13px" }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}