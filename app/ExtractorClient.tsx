"use client";
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { signOut } from "next-auth/react";

interface ExtractorProps {
  userEmail: string;
}

export default function ExtractorClient({ userEmail }: ExtractorProps) {
  // --- STATE ---
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePresetName, setActivePresetName] = useState("");
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<any[]>([]);
  const [banner, setBanner] = useState({ show: false, mode: "", text: "", targetId: null as string | null });
  
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
  
  const [logBox, setLogBox] = useState<string[]>(["Ready to configure."]);
  const [isRunning, setIsRunning] = useState(false);
  const stopRef = useRef(false);

  // --- LOGIC ---
  const log = (msg: string) => setLogBox(prev => [...prev, msg]);

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    const { data } = await supabase.from('saved_queries').select('*').order('created_at', { ascending: false });
    if (data) setSavedPresets(data);
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
    
    log(`Loaded preset: ${p.name}`);
  };

  const confirmAction = async (mode: string) => {
    log("Processing database request...");
    const payload = {
      user_email: userEmail,
      name: presetName || "Untitled",
      endpoint,
      method,
      headers: headers.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {}),
      params: params.reduce((acc, { key, value }) => (key ? { ...acc, [key]: value } : acc), {}),
      pagination: { offsetKey, limitKey, limitVal, startOffset, stepType, dataPath, maxRequests, delayMs }
    };

    try {
      if (mode === "saveAs") {
        const { data, error } = await supabase.from('saved_queries').insert([payload]).select();
        if (error) throw error;
        if (data && data[0]) {
          setActiveId(data[0].id);
          setActivePresetName(data[0].name);
        }
      }
      log("Success! Database operation complete.");
      fetchPresets();
    } catch (err: any) {
      log(`Database Error: ${err.message}`);
    }
  };

  const addField = (setter: any, state: any) => setter([...state, { key: "", value: "" }]);
  const updateField = (setter: any, state: any, i: number, field: string, val: string) => {
    const updated = [...state]; updated[i][field] = val; setter(updated);
  };
  const removeField = (setter: any, state: any, i: number) => {
    const updated = [...state]; updated.splice(i, 1); setter(updated);
  };

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  const handleExtract = async () => {
    setLogBox([]);
    log("Extracting data... please wait.");
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

        log(`[Req #${requestCount}] Fetching ${offsetKey}=${currentOffset}...`);

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
        log(`+ ${records.length} records (Total: ${allRecords.length})`);

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
        log(`Successfully downloaded ${allRecords.length} records.`);
      } else {
        log(`Finished. No data found.`);
      }
    } catch (err: any) {
      log(`Error: ${err.message}. Downloaded ${allRecords.length} records.`);
    }
    setIsRunning(false);
  };

  // --- UI ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans p-6 md:p-12 selection:bg-sky-500/30">
      <div className="max-w-6xl mx-auto space-y-8">
        
        <header className="border-b border-slate-800 pb-6 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">API Data Extractor</h1>
            <p className="text-slate-400 mt-2 text-sm">Configure your target endpoint, map pagination parameters, and export flat CSV data.</p>
          </div>
          <button onClick={() => signOut()} className="text-xs text-slate-400 hover:text-white transition-colors">
            Sign out {userEmail}
          </button>
        </header>
  
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-500/10 text-sky-400 text-xs font-bold">1</span>
                Connection Details
              </h2>
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <select 
                  value={method} 
                  onChange={(e) => setMethod(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 focus:ring-2 focus:ring-sky-500 outline-none sm:w-32"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
                <input 
                  type="text" 
                  placeholder="https://api.example.com/v1/data" 
                  value={endpoint} 
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 focus:ring-2 focus:ring-sky-500 outline-none flex-grow"
                />
              </div>

              {/* Dynamic Headers */}
              <div className="mb-6">
                <div className="flex justify-between items-center mb-3">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Headers</label>
                  <button onClick={() => addField(setHeaders, headers)} className="text-xs text-sky-400 hover:text-sky-300">+ Add Header</button>
                </div>
                <div className="space-y-2">
                  {headers.map((h, i) => (
                    <div key={i} className="flex gap-2">
                      <input type="text" placeholder="Key" value={h.key} onChange={(e) => updateField(setHeaders, headers, i, 'key', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 w-1/2 text-sm focus:ring-1 focus:ring-sky-500 outline-none" />
                      <input type="text" placeholder="Value" value={h.value} onChange={(e) => updateField(setHeaders, headers, i, 'value', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 w-1/2 text-sm focus:ring-1 focus:ring-sky-500 outline-none" />
                      <button onClick={() => removeField(setHeaders, headers, i)} className="px-3 text-slate-500 hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dynamic Params */}
              <div>
                <div className="flex justify-between items-center mb-3">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Query Parameters</label>
                  <button onClick={() => addField(setParams, params)} className="text-xs text-sky-400 hover:text-sky-300">+ Add Param</button>
                </div>
                <div className="space-y-2">
                  {params.map((p, i) => (
                    <div key={i} className="flex gap-2">
                      <input type="text" placeholder="Key" value={p.key} onChange={(e) => updateField(setParams, params, i, 'key', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 w-1/2 text-sm focus:ring-1 focus:ring-sky-500 outline-none" />
                      <input type="text" placeholder="Value" value={p.value} onChange={(e) => updateField(setParams, params, i, 'value', e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 w-1/2 text-sm focus:ring-1 focus:ring-sky-500 outline-none" />
                      <button onClick={() => removeField(setParams, params, i)} className="px-3 text-slate-500 hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
  
            <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-500/10 text-sky-400 text-xs font-bold">2</span>
                Pagination Engine
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Offset Param</label>
                  <input type="text" value={offsetKey} onChange={(e) => setOffsetKey(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 w-full outline-none focus:ring-1 focus:ring-sky-500 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Limit Param</label>
                  <input type="text" value={limitKey} onChange={(e) => setLimitKey(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 w-full outline-none focus:ring-1 focus:ring-sky-500 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Batch Limit</label>
                  <input type="number" value={limitVal} onChange={(e) => setLimitVal(e.target.value)} className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 w-full outline-none focus:ring-1 focus:ring-sky-500 text-sm" />
                </div>
              </div>
            </section>
          </div>
  
          {/* Action Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Presets Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h3 className="text-sm font-medium text-slate-300 mb-4">Saved Presets</h3>
              <div className="flex gap-2 mb-4">
                <input 
                  type="text" 
                  placeholder="Preset Name..." 
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm w-full outline-none focus:border-sky-500"
                />
                <button onClick={() => confirmAction("saveAs")} className="bg-slate-800 hover:bg-slate-700 border border-slate-600 px-3 rounded-lg text-sm transition-colors">
                  Save
                </button>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-700">
                {savedPresets.map(p => (
                  <button key={p.id} onClick={() => loadPreset(p)} className="w-full text-left px-3 py-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-sm text-slate-300 truncate transition-colors">
                    {p.name}
                  </button>
                ))}
                {savedPresets.length === 0 && <p className="text-xs text-slate-500">No presets saved yet.</p>}
              </div>
            </div>

            {/* Execution Card */}
            <div className="sticky top-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h3 className="text-sm font-medium text-slate-300 mb-4">Execution</h3>
              <button 
                onClick={isRunning ? () => stopRef.current = true : handleExtract}
                className={`w-full font-semibold py-3 px-4 rounded-xl transition-all active:scale-[0.98] ${
                  isRunning 
                    ? "bg-red-500/10 text-red-500 border border-red-500/50 hover:bg-red-500/20" 
                    : "bg-sky-500 hover:bg-sky-400 text-slate-950 shadow-[0_0_15px_rgba(14,165,233,0.3)] hover:shadow-[0_0_25px_rgba(14,165,233,0.5)]"
                }`}
              >
                {isRunning ? "Stop Execution" : "Start Extraction"}
              </button>
              
              {/* Live Terminal Log */}
              <div className="mt-6 bg-black/50 border border-slate-800 rounded-xl p-4 h-48 overflow-y-auto font-mono text-xs text-emerald-400/80 scrollbar-thin scrollbar-thumb-slate-700 break-words">
                {logBox.map((msg, idx) => (
                  <div key={idx} className="mb-1">{`> ${msg}`}</div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}