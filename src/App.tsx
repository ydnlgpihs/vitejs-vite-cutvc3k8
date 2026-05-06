import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

// 初始化 Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAY5YRBVUXeRvAime0AyLD2IOgO1MRlT8c",
  authDomain: "site-progress-a0c06.firebaseapp.com",
  databaseURL: "https://site-progress-a0c06-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "site-progress-a0c06",
  storageBucket: "site-progress-a0c06.firebasestorage.app",
  messagingSenderId: "428438475451",
  appId: "1:428438475451:web:c3757122cbac3d393c0f9e",
  measurementId: "G-MR858X7DSZ"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "my-site-project"; // 隨便改個英文名，用黎做資料夾分類

// Gemini API 設定
const apiKey = ""; 

// --- 圖片壓縮輔助函數 ---
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; // 限制最大寬度以減小體積
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6)); // 壓縮成 60% 品質的 JPG
      };
    };
    reader.onerror = error => reject(error);
  });
};

export default function App() {
  const [pdfReady, setPdfReady] = useState(false);
  const [projects, setProjects] = useState([]);
  const [subcategories, setSubcategories] = useState([]); // 新增：子分類狀態
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeSubcategoryId, setActiveSubcategoryId] = useState(""); // 新增：當前選中的子分類
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [markers, setMarkers] = useState({}); // { projectId: [ { id, subcategoryId, type, x, y, w, h, page, text } ] }
  const [tool, setTool] = useState('view'); // 'view', 'point', 'area'
  
  const [user, setUser] = useState(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentDraw, setCurrentDraw] = useState(null);

  // 自訂彈出視窗狀態
  const [markerModal, setMarkerModal] = useState({ isOpen: false, data: null, text: '', image: null, isProcessing: false });
  const [reportModal, setReportModal] = useState({ isOpen: false, report: '', isProcessing: false });
  const [projectModal, setProjectModal] = useState({ isOpen: false, name: '' });
  const [subModal, setSubModal] = useState({ isOpen: false, name: '' }); // 新增：子分類 Modal
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, markerId: null });

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputRef = useRef(null);

  // --- Gemini API 呼叫函數 ---
  const callGemini = async (promptText) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: "你是一個專業的工程項目經理與進度管理助理。請使用繁體中文回答。" }] }
    };

    let retries = 5;
    let delay = 1000;
    while (retries > 0) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error.message);
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 沒有返回內容。";
      } catch (error) {
        retries--;
        if (retries === 0) {
          console.error("Gemini API Error:", error);
          return "AI 生成失敗，請稍後再試。";
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  };

  // --- Firebase 身份驗證 ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- 監聽 Firebase 雲端數據 ---
  useEffect(() => {
    if (!user) return;

    const projectsRef = collection(db, 'artifacts', appId, 'public', 'data', 'projects');
    const subcatsRef = collection(db, 'artifacts', appId, 'public', 'data', 'subcategories');
    const markersRef = collection(db, 'artifacts', appId, 'public', 'data', 'markers');

    const unsubProjects = onSnapshot(projectsRef, (snapshot) => {
      const projs = [];
      snapshot.forEach(doc => projs.push(doc.data()));
      if (projs.length > 0) {
        setProjects(projs);
        setActiveProjectId(prev => prev || projs[0].id);
      } else {
        const defaultProject = { id: Date.now().toString(), name: '預設工程項目' };
        setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', defaultProject.id), defaultProject);
      }
    }, console.error);

    const unsubSubcats = onSnapshot(subcatsRef, (snapshot) => {
      const subs = [];
      snapshot.forEach(doc => subs.push(doc.data()));
      setSubcategories(subs);
    }, console.error);

    const unsubMarkers = onSnapshot(markersRef, (snapshot) => {
      const marks = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!marks[data.projectId]) marks[data.projectId] = [];
        marks[data.projectId].push(data);
      });
      setMarkers(marks);
    }, console.error);

    return () => {
      unsubProjects();
      unsubSubcats();
      unsubMarkers();
    };
  }, [user]);

  // 自動維護選中的子分類狀態
  useEffect(() => {
    if (!activeProjectId) return;
    const projectSubs = subcategories.filter(s => s.projectId === activeProjectId);
    
    // 如果該項目沒有任何子分類，自動創建一個預設的
    if (projectSubs.length === 0 && subcategories.length > 0) {
      const defaultSub = { id: Date.now().toString(), projectId: activeProjectId, name: '未分類 / 預設區域' };
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', defaultSub.id), defaultSub);
    } 
    // 如果當前選中的子分類不屬於當前項目，自動切換至第一個
    else if (projectSubs.length > 0 && !projectSubs.find(s => s.id === activeSubcategoryId)) {
      setActiveSubcategoryId(projectSubs[0].id);
    }
  }, [activeProjectId, subcategories, activeSubcategoryId]);

  // --- 初始化 PDF.js ---
  useEffect(() => {
    const loadPdfJs = () => {
      if (window.pdfjsLib) {
        setPdfReady(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        setPdfReady(true);
      };
      document.body.appendChild(script);
    };
    loadPdfJs();
  }, []);

  // --- 渲染 PDF 頁面 ---
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current || !overlayRef.current) return;
      
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      overlayRef.current.style.width = `${viewport.width}px`;
      overlayRef.current.style.height = `${viewport.height}px`;

      const renderContext = { canvasContext: ctx, viewport: viewport };
      await page.render(renderContext).promise;
    };

    renderPage();
  }, [pdfDoc, currentPage]);

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !pdfReady) return;

    const fileUrl = URL.createObjectURL(file);
    try {
      const loadingTask = window.pdfjsLib.getDocument(fileUrl);
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
    } catch (error) {
      console.error("PDF 載入失敗:", error);
    }
  };

  const openAddProjectModal = () => setProjectModal({ isOpen: true, name: '' });
  
  const confirmAddProject = async () => {
    const { name } = projectModal;
    if (name.trim() && user) {
      const newProjectId = Date.now().toString();
      const newProject = { id: newProjectId, name: name.trim() };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', newProject.id), newProject);
      setActiveProjectId(newProject.id);
      // 同時創建預設子分類
      const defaultSub = { id: Date.now().toString() + '_sub', projectId: newProjectId, name: '一般 / 未分類' };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', defaultSub.id), defaultSub);
    }
    setProjectModal({ isOpen: false, name: '' });
  };

  const openAddSubModal = () => setSubModal({ isOpen: true, name: '' });

  const confirmAddSubcategory = async () => {
    const { name } = subModal;
    if (name.trim() && user && activeProjectId) {
      const newSubId = Date.now().toString();
      const newSub = { id: newSubId, projectId: activeProjectId, name: name.trim() };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', newSub.id), newSub);
      setActiveSubcategoryId(newSub.id);
    }
    setSubModal({ isOpen: false, name: '' });
  };

  // --- 滑鼠互動事件 ---
  const handleOverlayMouseDown = (e) => {
    if (tool === 'view' || !activeSubcategoryId) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (tool === 'point') {
      setMarkerModal({
        isOpen: true,
        data: { type: 'point', x, y, page: currentPage },
        text: '',
        image: null,
        isProcessing: false
      });
    } else if (tool === 'area') {
      setIsDrawing(true);
      setDrawStart({ x, y });
      setCurrentDraw({ x, y, w: 0, h: 0 });
    }
  };

  const handleOverlayMouseMove = (e) => {
    if (!isDrawing || tool !== 'area') return;
    const rect = overlayRef.current.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;

    setCurrentDraw({
      x: Math.min(drawStart.x, currentX),
      y: Math.min(drawStart.y, currentY),
      w: Math.abs(currentX - drawStart.x),
      h: Math.abs(currentY - drawStart.y)
    });
  };

  const handleOverlayMouseUp = () => {
    if (!isDrawing || tool !== 'area') return;
    setIsDrawing(false);
    
    if (currentDraw.w > 2 && currentDraw.h > 2) {
      setMarkerModal({
        isOpen: true,
        data: { type: 'area', x: currentDraw.x, y: currentDraw.y, w: currentDraw.w, h: currentDraw.h, page: currentPage },
        text: '',
        image: null,
        isProcessing: false
      });
    }
    setCurrentDraw(null);
  };

  // --- 儲存標記 ---
  const handleModalImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setMarkerModal(prev => ({ ...prev, isProcessing: true }));
    try {
      const compressedBase64 = await compressImage(file);
      setMarkerModal(prev => ({ ...prev, image: compressedBase64, isProcessing: false }));
    } catch (error) {
      console.error("圖片壓縮失敗:", error);
      setMarkerModal(prev => ({ ...prev, isProcessing: false }));
    }
  };

  const saveMarkerFromModal = async () => {
    if (!user || !markerModal.text.trim() || !activeSubcategoryId) return;
    const newMarker = { 
      id: Date.now().toString(), 
      projectId: activeProjectId, 
      subcategoryId: activeSubcategoryId, // 綁定當前選中的子分類
      text: markerModal.text, 
      image: markerModal.image, 
      ...markerModal.data 
    };
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'markers', newMarker.id), newMarker);
    setMarkerModal({ isOpen: false, data: null, text: '', image: null, isProcessing: false });
    setTool('view');
  };

  const requestDeleteMarker = (markerId) => {
    setConfirmModal({ isOpen: true, markerId });
  };

  const confirmDeleteMarker = async () => {
    if (confirmModal.markerId && user) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'markers', confirmModal.markerId));
    }
    setConfirmModal({ isOpen: false, markerId: null });
  };

  // --- Gemini 輔助功能 ---
  const refineMarkerText = async () => {
    if (!markerModal.text.trim()) return;
    setMarkerModal(prev => ({ ...prev, isProcessing: true }));
    const prompt = `將以下現場工程人員的粗略備註，重寫成一句專業、簡潔且具行動性的工程記錄描述（不用打招呼或多餘解釋）：\n\n「${markerModal.text}」`;
    const refinedText = await callGemini(prompt);
    setMarkerModal(prev => ({ ...prev, text: refinedText, isProcessing: false }));
  };

  const generateProjectReport = async () => {
    // 總結當前子分類的所有標記
    const currentSubMarkers = (markers[activeProjectId] || []).filter(m => m.subcategoryId === activeSubcategoryId);
    if (currentSubMarkers.length === 0) return;

    setReportModal({ isOpen: true, report: '', isProcessing: true });
    
    const activeSubName = subcategories.find(s => s.id === activeSubcategoryId)?.name || '未知區域';
    const markerLines = currentSubMarkers.map((m, i) => 
      `${i+1}. [第${m.page}頁] ${m.type === 'point' ? '位置點' : '範圍'}: ${m.text}`
    ).join('\n');

    const prompt = `根據以下由現場人員標記的工程事項紀錄（區域/分類：${activeSubName}），生成一份 Markdown 格式的「工程進度與問題總結報告」。
請將內容分類歸納（例如：品質異常、進度更新、安全隱患等），並列出建議的待辦清單：

紀錄如下：
${markerLines}`;

    const reportContent = await callGemini(prompt);
    setReportModal({ isOpen: true, report: reportContent, isProcessing: false });
  };

  // 篩選當前項目、當前子分類、當前頁面的標記
  const currentProjectMarkers = (markers[activeProjectId] || []).filter(
    m => m.page === currentPage && m.subcategoryId === activeSubcategoryId
  );

  const currentProjectSubs = subcategories.filter(s => s.projectId === activeProjectId);

  if (!pdfReady) return <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-600">系統載入中 (PDF.js)...</div>;

  return (
    <div className="flex h-screen w-full bg-gray-100 font-sans text-gray-800">
      
      {/* 左側邊欄 - 分類與記錄 */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-sm flex-shrink-0 z-20">
        <div className="p-4 border-b border-gray-200 bg-gray-50 space-y-4">
          <h1 className="text-lg font-bold text-gray-800">進度管理系統</h1>
          
          {/* 主項目選擇 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">📁 專案項目</span>
              <button onClick={openAddProjectModal} className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700 transition">
                + 新增項目
              </button>
            </div>
            <select 
              value={activeProjectId} 
              onChange={(e) => setActiveProjectId(e.target.value)}
              className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 outline-none font-medium text-gray-700"
            >
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* 子分類選擇 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">🏷️ 分類 / 區域</span>
              <button onClick={openAddSubModal} disabled={!activeProjectId} className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded hover:bg-indigo-600 transition disabled:opacity-50">
                + 新增區域
              </button>
            </div>
            <select 
              value={activeSubcategoryId} 
              onChange={(e) => setActiveSubcategoryId(e.target.value)}
              disabled={currentProjectSubs.length === 0}
              className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-gray-100 text-gray-700"
            >
              {currentProjectSubs.length === 0 && <option value="">(無分類)</option>}
              {currentProjectSubs.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          
          <button 
            onClick={generateProjectReport}
            disabled={currentProjectMarkers.length === 0}
            className="w-full bg-indigo-50 text-indigo-700 border border-indigo-200 py-2 rounded text-sm font-semibold hover:bg-indigo-100 transition disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 mt-2"
          >
            ✨ AI 區域總結報告
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold text-gray-500">當前頁面標記</h2>
            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{currentProjectMarkers.length}</span>
          </div>
          
          {currentProjectMarkers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8 bg-gray-50 rounded border border-dashed border-gray-200">
              此頁面及區域尚未有任何進度標記。<br/><br/>請在右方選擇標記工具開始記錄。
            </p>
          ) : (
            <div className="space-y-3">
              {currentProjectMarkers.map(marker => (
                <div key={marker.id} className="bg-white border border-gray-200 rounded p-3 relative group shadow-sm hover:border-blue-300 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="w-full pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1.5 tracking-wider ${marker.type === 'point' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {marker.type === 'point' ? '📍 單點' : '🔲 範圍'}
                      </span>
                      <p className="text-sm text-gray-800 break-words leading-snug">{marker.text}</p>
                      {marker.image && (
                        <img src={marker.image} alt="現場照片" className="mt-2 rounded border border-gray-200 w-full max-h-40 object-cover" />
                      )}
                    </div>
                    <button 
                      onClick={() => requestDeleteMarker(marker.id)}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm"
                      title="刪除"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右側主要工作區 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 頂部工具列 */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center space-x-4">
            <input 
              type="file" 
              accept="application/pdf" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button 
              onClick={() => fileInputRef.current.click()}
              className="bg-gray-800 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-gray-700 transition shadow-sm"
            >
              上傳圖紙 (PDF)
            </button>

            {pdfDoc && (
              <div className="flex items-center space-x-2 bg-gray-100 rounded px-2 py-1 shadow-inner">
                <button 
                  disabled={currentPage <= 1} 
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  className="px-2 py-1 text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm rounded transition disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:shadow-none"
                >
                  上一頁
                </button>
                <span className="text-sm font-bold text-gray-700 px-2 min-w-[3rem] text-center">{currentPage} / {totalPages}</span>
                <button 
                  disabled={currentPage >= totalPages} 
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  className="px-2 py-1 text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm rounded transition disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:shadow-none"
                >
                  下一頁
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2 bg-gray-100 p-1 rounded-lg shadow-inner">
            <button 
              onClick={() => { setTool('view'); setMarkerModal(prev => ({...prev, isOpen: false})); }}
              className={`px-3 py-1.5 rounded text-sm font-medium transition ${tool === 'view' ? 'bg-white shadow text-blue-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}
            >
              ✋ 瀏覽
            </button>
            <button 
              onClick={() => setTool('point')}
              disabled={!activeSubcategoryId}
              className={`px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${tool === 'point' ? 'bg-white shadow text-red-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}
            >
              📍 點標記
            </button>
            <button 
              onClick={() => setTool('area')}
              disabled={!activeSubcategoryId}
              className={`px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${tool === 'area' ? 'bg-white shadow text-orange-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}
            >
              🔲 範圍標記
            </button>
          </div>
        </div>

        {/* PDF 顯示區 */}
        <div className="flex-1 overflow-auto bg-gray-300 flex justify-center p-6 relative">
          {!pdfDoc ? (
            <div className="text-gray-500 mt-20 flex flex-col items-center">
              <svg className="w-16 h-16 mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <p className="font-medium">請先上傳 PDF 檔案以開始標記</p>
              <p className="text-sm text-gray-400 mt-2">提示：左側可建立多個區域分類（如：1樓、2樓）</p>
            </div>
          ) : (
            <div className="relative shadow-xl bg-white inline-block border border-gray-200">
              <canvas ref={canvasRef} className="block" />
              
              {/* 互動覆蓋層 */}
              <div 
                ref={overlayRef}
                className={`absolute top-0 left-0 ${tool !== 'view' ? 'cursor-crosshair' : 'cursor-default'}`}
                onMouseDown={handleOverlayMouseDown}
                onMouseMove={handleOverlayMouseMove}
                onMouseUp={handleOverlayMouseUp}
                onMouseLeave={handleOverlayMouseUp}
              >
                {/* 渲染現有標記 (只顯示當前區域) */}
                {currentProjectMarkers.map(marker => {
                  if (marker.type === 'point') {
                    return (
                      <div 
                        key={marker.id}
                        className="absolute w-5 h-5 bg-red-500 rounded-full border-[3px] border-white shadow-md transform -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform"
                        style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                        title={marker.text}
                      />
                    );
                  }
                  if (marker.type === 'area') {
                    return (
                      <div 
                        key={marker.id}
                        className="absolute border-[3px] border-orange-500 bg-orange-500 bg-opacity-20 cursor-pointer hover:bg-opacity-40 transition-colors shadow-sm"
                        style={{ left: `${marker.x}%`, top: `${marker.y}%`, width: `${marker.w}%`, height: `${marker.h}%` }}
                        title={marker.text}
                      />
                    );
                  }
                  return null;
                })}

                {/* 渲染繪製中嘅範圍 */}
                {isDrawing && currentDraw && tool === 'area' && (
                  <div 
                    className="absolute border-[3px] border-blue-500 bg-blue-500 bg-opacity-30 pointer-events-none"
                    style={{ left: `${currentDraw.x}%`, top: `${currentDraw.y}%`, width: `${currentDraw.w}%`, height: `${currentDraw.h}%` }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- 新增標記 Modal --- */}
      {markerModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-[26rem] overflow-hidden flex flex-col transform transition-all">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-lg">
                {markerModal.data.type === 'point' ? '📍 新增點標記' : '🔲 新增範圍標記'}
              </h3>
              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                區域: {subcategories.find(s=>s.id === activeSubcategoryId)?.name}
              </span>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <textarea 
                value={markerModal.text}
                onChange={e => setMarkerModal(prev => ({...prev, text: e.target.value}))}
                placeholder="在此輸入現場情況或備註（如：天花滲水需重造防水層）..."
                className="w-full h-28 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none transition-shadow"
                disabled={markerModal.isProcessing}
              />
              {markerModal.image && (
                <div className="relative inline-block self-start">
                  <img src={markerModal.image} alt="預覽" className="h-24 rounded-lg border border-gray-200 object-cover shadow-sm" />
                  <button onClick={() => setMarkerModal(prev => ({...prev, image: null}))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-md hover:bg-red-600 transition">✕</button>
                </div>
              )}
              <div className="flex gap-2 items-center">
                <button 
                  onClick={refineMarkerText}
                  disabled={markerModal.isProcessing || !markerModal.text.trim()}
                  className="text-xs bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-100 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 font-medium border border-indigo-100"
                >
                  {markerModal.isProcessing ? '✨ AI 思考中...' : '✨ AI 專業化描述'}
                </button>
                <label className="text-xs bg-gray-50 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition cursor-pointer flex items-center gap-1.5 font-medium border border-gray-200">
                  📷 附加圖片
                  <input type="file" accept="image/*" className="hidden" onChange={handleModalImageUpload} disabled={markerModal.isProcessing} />
                </label>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button 
                onClick={() => { setMarkerModal({ isOpen: false, data: null, text: '', image: null, isProcessing: false }); setTool('view'); }}
                className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition"
              >
                取消
              </button>
              <button 
                onClick={saveMarkerFromModal}
                disabled={!markerModal.text.trim() || markerModal.isProcessing}
                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition disabled:opacity-50 disabled:shadow-none"
              >
                儲存記錄
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 智能報告 Modal --- */}
      {reportModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-6 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-full flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 flex items-center gap-2 text-lg">
                ✨ AI 區域總結報告
              </h3>
              <button 
                onClick={() => setReportModal({ isOpen: false, report: '', isProcessing: false })}
                className="text-gray-400 hover:text-gray-600 text-2xl font-bold transition"
              >
                &times;
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 bg-white">
              {reportModal.isProcessing ? (
                <div className="flex flex-col items-center justify-center h-40 text-indigo-600">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                  <p className="text-sm font-medium">AI 正在為此區域生成進度與問題總結，請稍候...</p>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {reportModal.report}
                </div>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 flex justify-end border-t border-gray-100">
              <button 
                onClick={() => setReportModal({ isOpen: false, report: '', isProcessing: false })}
                className="px-6 py-2 text-sm font-bold text-white bg-gray-800 hover:bg-gray-900 rounded-lg shadow-sm transition"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 新增專案 Modal --- */}
      {projectModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-800">新增工程項目</h3>
            </div>
            <div className="p-5">
              <input 
                type="text" 
                value={projectModal.name}
                onChange={e => setProjectModal(prev => ({...prev, name: e.target.value}))}
                placeholder="例如：何文田住宅發展項目"
                className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                autoFocus
              />
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setProjectModal({ isOpen: false, name: '' })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">取消</button>
              <button onClick={confirmAddProject} disabled={!projectModal.name.trim()} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition disabled:opacity-50">確認建立</button>
            </div>
          </div>
        </div>
      )}

      {/* --- 新增子分類 Modal --- */}
      {subModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-indigo-700">新增分類 / 區域</h3>
            </div>
            <div className="p-5">
              <input 
                type="text" 
                value={subModal.name}
                onChange={e => setSubModal(prev => ({...prev, name: e.target.value}))}
                placeholder="例如：T1座 18樓"
                className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow"
                autoFocus
              />
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setSubModal({ isOpen: false, name: '' })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">取消</button>
              <button onClick={confirmAddSubcategory} disabled={!subModal.name.trim()} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition disabled:opacity-50">確認建立</button>
            </div>
          </div>
        </div>
      )}

      {/* --- 確認刪除 Modal --- */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-red-50 bg-red-50">
              <h3 className="font-bold text-red-600">確認刪除</h3>
            </div>
            <div className="p-5 text-sm text-gray-700 font-medium">
              確定要刪除這個標記嗎？此動作無法復原。
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setConfirmModal({ isOpen: false, markerId: null })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">保留</button>
              <button onClick={confirmDeleteMarker} className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition">確認刪除</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}