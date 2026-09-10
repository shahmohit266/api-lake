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
    <div className="min-h-screen bg-slate-950 text-slate-300 font-sans p-6 md:p-12 selection:bg-sky-500/30">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="border-b border-slate-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">API Data Extractor</h1>
          <p className="text-slate-400 mt-2 text-sm">Configure your target endpoint, map pagination parameters, and export flat CSV data.</p>
        </header>
  
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Configuration Column */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Card 1: Connection Details */}
            <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-500/10 text-sky-400 text-xs font-bold">1</span>
                Connection Details
              </h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <select 
                  value={method} 
                  onChange={(e) => setMethod(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none w-full sm:w-32 transition-all"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
                <input 
                  type="text" 
                  placeholder="https://api.example.com/v1/data" 
                  value={endpoint} 
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-200 focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none flex-grow transition-all placeholder:text-slate-600"
                />
              </div>
              {/* Map your headers/params state loops here using similar input styling */}
            </section>
  
            {/* Card 2: Pagination Engine */}
            <section className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-sm backdrop-blur-sm">
              <h2 className="text-lg font-medium text-slate-200 mb-4 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-500/10 text-sky-400 text-xs font-bold">2</span>
                Pagination Engine
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Offset Parameter</label>
                  <input type="text" placeholder="e.g., offset" className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 w-full focus:ring-2 focus:ring-sky-500 outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Limit Parameter</label>
                  <input type="text" placeholder="e.g., limit" className="bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-slate-200 w-full focus:ring-2 focus:ring-sky-500 outline-none" />
                </div>
              </div>
            </section>
          </div>
  
          {/* Action Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-lg">
              <h3 className="text-sm font-medium text-slate-300 mb-4">Ready to Extract</h3>
              <button 
                onClick={startExtraction}
                className="w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold py-3 px-4 rounded-xl transition-all shadow-[0_0_15px_rgba(14,165,233,0.3)] hover:shadow-[0_0_25px_rgba(14,165,233,0.5)] active:scale-[0.98]"
              >
                Start Extraction 
              </button>
              
              {/* Live Terminal Log */}
              <div className="mt-6 bg-black/50 border border-slate-800 rounded-xl p-4 h-48 overflow-y-auto font-mono text-xs text-emerald-400/80 scrollbar-thin scrollbar-thumb-slate-700">
                {logBox.map((log, idx) => (
                  <div key={idx} className="mb-1">{`> ${log}`}</div>
                ))}
              </div>
            </div>
          </div>
  
        </div>
      </div>
    </div>
  );
}