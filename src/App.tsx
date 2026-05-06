// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

// ==========================================
// 1. Firebase 設定 (請填入你自己的資料)
// ==========================================
const firebaseConfig = {
  //apiKey: "AIzaSyAY5YRBVUXeRvAime0AyLD2IOgO1MRlT8c",
  //authDomain: "site-progress-a0c06.firebaseapp.com",
  //projectId: "site-progress-a0c06",
  //storageBucket: "site-progress-a0c06.firebasestorage.app",
  //messagingSenderId: "428438475451",
  //appId: "1:428438475451:web:c3757122cbac3d393c0f9e",
};

// 安全初始化
const validFirebaseConfig = Object.keys(firebaseConfig).length > 0 ? firebaseConfig : {};
const app = initializeApp(validFirebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "engineering-progress-system";

// ==========================================
// 2. 輔助函數：前端極限壓縮圖片
// ==========================================
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; 
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6)); 
      };
    };
    reader.onerror = error => reject(error);
  });
};

// ==========================================
// 3. 主程式元件
// ==========================================
export default function App() {
  // 系統狀態
  const [user, setUser] = useState(null);
  const [pdfReady, setPdfReady] = useState(false);
  
  // 數據狀態
  const [projects, setProjects] = useState([]);
  const [subcategories, setSubcategories] = useState([]); 
  const [markers, setMarkers] = useState({}); 
  
  // 選擇狀態
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeSubcategoryId, setActiveSubcategoryId] = useState(""); 
  
  // PDF 與畫布狀態
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [tool, setTool] = useState('view'); // 'view', 'point', 'area'
  
  // 繪圖互動狀態
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentDraw, setCurrentDraw] = useState(null);

  // 彈出視窗 (Modal) 狀態
  const [markerModal, setMarkerModal] = useState({ isOpen: false, data: null, text: '', image: null });
  const [projectModal, setProjectModal] = useState({ isOpen: false, name: '' });
  const [subModal, setSubModal] = useState({ isOpen: false, name: '' }); 
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, markerId: null });

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputRef = useRef(null);

  // --- 啟動 Firebase 匿名登入 ---
  useEffect(() => {
    const initAuth = async () => {
      try { await signInAnonymously(auth); } 
      catch (error) { console.error("Firebase 登入失敗 (請確保後台已開啟匿名登入):", error); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- 訂閱 Firebase 實時數據庫 ---
  useEffect(() => {
    if (!user) return;

    const projectsRef = collection(db, 'artifacts', appId, 'public', 'data', 'projects');
    const subcatsRef = collection(db, 'artifacts', appId, 'public', 'data', 'subcategories');
    const markersRef = collection(db, 'artifacts', appId, 'public', 'data', 'markers');

    const unsubProjects = onSnapshot(projectsRef, (snapshot) => {
      const projs = [];
      snapshot.forEach(doc => projs.push(doc.data()));
      setProjects(projs);
      if (projs.length > 0 && !activeProjectId) setActiveProjectId(projs[0].id);
    }, (error) => console.error("讀取專案失敗:", error));

    const unsubSubcats = onSnapshot(subcatsRef, (snapshot) => {
      const subs = [];
      snapshot.forEach(doc => subs.push(doc.data()));
      setSubcategories(subs);
    }, (error) => console.error("讀取分類失敗:", error));

    const unsubMarkers = onSnapshot(markersRef, (snapshot) => {
      const marks = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!marks[data.projectId]) marks[data.projectId] = [];
        marks[data.projectId].push(data);
      });
      setMarkers(marks);
    }, (error) => console.error("讀取標記失敗:", error));

    return () => { unsubProjects(); unsubSubcats(); unsubMarkers(); };
  }, [user, activeProjectId]);

  // --- 自動維護子分類狀態 ---
  useEffect(() => {
    if (!activeProjectId || !user) return;
    const projectSubs = subcategories.filter(s => s.projectId === activeProjectId);
    
    if (projectSubs.length === 0 && subcategories.length > 0) {
      // 若項目無分類，自動建立一個
      const defaultSub = { id: Date.now().toString(), projectId: activeProjectId, name: '未分類 / 預設區域' };
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', defaultSub.id), defaultSub).catch(console.error);
    } else if (projectSubs.length > 0 && !projectSubs.find(s => s.id === activeSubcategoryId)) {
      // 自動切換到該項目的第一個分類
      setActiveSubcategoryId(projectSubs[0].id);
    }
  }, [activeProjectId, subcategories, activeSubcategoryId, user]);

  // --- 載入 PDF.js 核心 ---
  useEffect(() => {
    const loadPdfJs = () => {
      if (window.pdfjsLib) { setPdfReady(true); return; }
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

  // --- 渲染 PDF 圖紙 ---
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current || !overlayRef.current) return;
      
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: 1.5 }); // 預設縮放比例
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
    } catch (error) { console.error("PDF 載入失敗:", error); }
  };

  // --- 創建與刪除操作 ---
  const confirmAddProject = async () => {
    if (projectModal.name.trim() && user) {
      const newProjectId = Date.now().toString();
      const newProject = { id: newProjectId, name: projectModal.name.trim() };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', newProject.id), newProject).catch(console.error);
      setActiveProjectId(newProject.id);
      
      const defaultSub = { id: Date.now().toString() + '_sub', projectId: newProjectId, name: '一般區域' };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', defaultSub.id), defaultSub).catch(console.error);
    }
    setProjectModal({ isOpen: false, name: '' });
  };

  const confirmAddSubcategory = async () => {
    if (subModal.name.trim() && user && activeProjectId) {
      const newSub = { id: Date.now().toString(), projectId: activeProjectId, name: subModal.name.trim() };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', newSub.id), newSub).catch(console.error);
      setActiveSubcategoryId(newSub.id);
    }
    setSubModal({ isOpen: false, name: '' });
  };

  // --- 畫布滑鼠互動 (標記進度) ---
  const handleOverlayMouseDown = (e) => {
    if (tool === 'view' || !activeSubcategoryId) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (tool === 'point') {
      setMarkerModal({ isOpen: true, data: { type: 'point', x, y, page: currentPage }, text: '', image: null });
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
    if (currentDraw.w > 1 && currentDraw.h > 1) {
      setMarkerModal({
        isOpen: true,
        data: { type: 'area', x: currentDraw.x, y: currentDraw.y, w: currentDraw.w, h: currentDraw.h, page: currentPage },
        text: '', image: null
      });
    }
    setCurrentDraw(null);
  };

  // --- 儲存與上傳標記 ---
  const handleModalImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const compressedBase64 = await compressImage(file);
      setMarkerModal(prev => ({ ...prev, image: compressedBase64 }));
    } catch (error) { console.error("圖片壓縮失敗:", error); }
  };

  const saveMarkerFromModal = async () => {
    if (!user || !markerModal.text.trim() || !activeSubcategoryId) return;
    const newMarker = { 
      id: Date.now().toString(), 
      projectId: activeProjectId, 
      subcategoryId: activeSubcategoryId, 
      text: markerModal.text, 
      image: markerModal.image, 
      ...markerModal.data 
    };
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'markers', newMarker.id), newMarker).catch(console.error);
    setMarkerModal({ isOpen: false, data: null, text: '', image: null });
    setTool('view');
  };

  const confirmDeleteMarker = async () => {
    if (confirmModal.markerId && user) {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'markers', confirmModal.markerId)).catch(console.error);
    }
    setConfirmModal({ isOpen: false, markerId: null });
  };

  // --- 過濾顯示資料 ---
  const currentProjectSubs = subcategories.filter(s => s.projectId === activeProjectId);
  const currentProjectMarkers = (markers[activeProjectId] || []).filter(
    m => m.page === currentPage && m.subcategoryId === activeSubcategoryId
  );

  // 載入畫面
  if (!pdfReady) return <div className="flex h-screen items-center justify-center bg-gray-50 text-gray-600">系統載入中 (準備 PDF 引擎)...</div>;

  return (
    <div className="flex h-screen w-full bg-gray-100 font-sans text-gray-800">
      
      {/* ================= 左側邊欄 ================= */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col shadow-sm flex-shrink-0 z-20">
        <div className="p-4 border-b border-gray-200 bg-gray-50 space-y-4">
          <h1 className="text-lg font-bold text-gray-800">工程進度管理系統</h1>
          
          {/* 專案層級 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">📁 專案項目</span>
              <button onClick={() => setProjectModal({ isOpen: true, name: '' })} className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded hover:bg-blue-700 transition">+ 新增項目</button>
            </div>
            <select value={activeProjectId} onChange={(e) => setActiveProjectId(e.target.value)} className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-blue-500 focus:border-blue-500 outline-none font-medium text-gray-700">
              {projects.length === 0 && <option value="">請先新增項目</option>}
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* 區域子分類層級 */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">🏷️ 分類 / 區域</span>
              <button onClick={() => setSubModal({ isOpen: true, name: '' })} disabled={!activeProjectId} className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded hover:bg-indigo-600 transition disabled:opacity-50">+ 新增區域</button>
            </div>
            <select value={activeSubcategoryId} onChange={(e) => setActiveSubcategoryId(e.target.value)} disabled={currentProjectSubs.length === 0} className="w-full border border-gray-300 rounded p-1.5 text-sm focus:ring-indigo-500 focus:border-indigo-500 outline-none disabled:bg-gray-100 text-gray-700">
              {currentProjectSubs.length === 0 && <option value="">(無可用區域)</option>}
              {currentProjectSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>

        {/* 標記清單 */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold text-gray-500">當前區域及頁面標記</h2>
            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{currentProjectMarkers.length}</span>
          </div>
          
          {currentProjectMarkers.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8 bg-gray-50 rounded border border-dashed border-gray-200">此範圍尚未有任何標記。<br/><br/>請先上傳 PDF 並選擇右方工具。</p>
          ) : (
            <div className="space-y-3">
              {currentProjectMarkers.map(marker => (
                <div key={marker.id} className="bg-white border border-gray-200 rounded p-3 relative group shadow-sm">
                  <div className="flex items-start justify-between">
                    <div className="w-full pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1.5 tracking-wider ${marker.type === 'point' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {marker.type === 'point' ? '📍 單點' : '🔲 範圍'}
                      </span>
                      <p className="text-sm text-gray-800 break-words leading-snug">{marker.text}</p>
                      {marker.image && <img src={marker.image} alt="現場照片" className="mt-2 rounded border border-gray-200 w-full max-h-40 object-cover" />}
                    </div>
                    <button onClick={() => setConfirmModal({ isOpen: true, markerId: marker.id })} className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition absolute top-2 right-2 p-1 bg-white rounded-full shadow-sm" title="刪除">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ================= 右側主要工作區 ================= */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 工具列 */}
        <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm z-10">
          <div className="flex items-center space-x-4">
            <input type="file" accept="application/pdf" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <button onClick={() => fileInputRef.current.click()} className="bg-gray-800 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-gray-700 transition shadow-sm">上傳圖紙 (PDF)</button>
            {pdfDoc && (
              <div className="flex items-center space-x-2 bg-gray-100 rounded px-2 py-1 shadow-inner">
                <button disabled={currentPage <= 1} onClick={() => setCurrentPage(prev => prev - 1)} className="px-2 py-1 text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm rounded transition disabled:opacity-50">上一頁</button>
                <span className="text-sm font-bold text-gray-700 px-2 min-w-[3rem] text-center">{currentPage} / {totalPages}</span>
                <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(prev => prev + 1)} className="px-2 py-1 text-sm font-medium text-gray-600 hover:bg-white hover:shadow-sm rounded transition disabled:opacity-50">下一頁</button>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-2 bg-gray-100 p-1 rounded-lg shadow-inner">
            <button onClick={() => setTool('view')} className={`px-3 py-1.5 rounded text-sm font-medium transition ${tool === 'view' ? 'bg-white shadow text-blue-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}>✋ 瀏覽</button>
            <button onClick={() => setTool('point')} disabled={!activeSubcategoryId} className={`px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50 ${tool === 'point' ? 'bg-white shadow text-red-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}>📍 點標記</button>
            <button onClick={() => setTool('area')} disabled={!activeSubcategoryId} className={`px-3 py-1.5 rounded text-sm font-medium transition disabled:opacity-50 ${tool === 'area' ? 'bg-white shadow text-orange-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}>🔲 範圍標記</button>
          </div>
        </div>

        {/* PDF 圖紙與標記層 */}
        <div className="flex-1 overflow-auto bg-gray-300 flex justify-center p-6 relative">
          {!pdfDoc ? (
            <div className="text-gray-500 mt-20 flex flex-col items-center">
              <svg className="w-16 h-16 mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              <p className="font-medium text-lg">請先上傳 PDF 檔案作為底圖</p>
              <p className="text-sm text-gray-400 mt-2">（注意：圖紙僅存於本機瀏覽器，不會消耗雲端空間）</p>
            </div>
          ) : (
            <div className="relative shadow-xl bg-white inline-block border border-gray-200">
              <canvas ref={canvasRef} className="block" />
              <div ref={overlayRef} className={`absolute top-0 left-0 ${tool !== 'view' ? 'cursor-crosshair' : 'cursor-default'}`} onMouseDown={handleOverlayMouseDown} onMouseMove={handleOverlayMouseMove} onMouseUp={handleOverlayMouseUp} onMouseLeave={handleOverlayMouseUp}>
                
                {/* 渲染現有標記 */}
                {currentProjectMarkers.map(marker => {
                  if (marker.type === 'point') return (
                    <div key={marker.id} className="absolute w-5 h-5 bg-red-500 rounded-full border-[3px] border-white shadow-md transform -translate-x-1/2 -translate-y-1/2 hover:scale-125 transition-transform" style={{ left: `${marker.x}%`, top: `${marker.y}%` }} title={marker.text}/>
                  );
                  if (marker.type === 'area') return (
                    <div key={marker.id} className="absolute border-[3px] border-orange-500 bg-orange-500 bg-opacity-20 cursor-pointer hover:bg-opacity-40 transition-colors shadow-sm" style={{ left: `${marker.x}%`, top: `${marker.y}%`, width: `${marker.w}%`, height: `${marker.h}%` }} title={marker.text}/>
                  );
                  return null;
                })}

                {/* 渲染繪製中虛框 */}
                {isDrawing && currentDraw && tool === 'area' && (
                  <div className="absolute border-[3px] border-blue-500 border-dashed bg-blue-500 bg-opacity-30 pointer-events-none" style={{ left: `${currentDraw.x}%`, top: `${currentDraw.y}%`, width: `${currentDraw.w}%`, height: `${currentDraw.h}%` }}/>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= 彈出視窗群組 ================= */}
      
      {/* 1. 新增/編輯標記 Modal */}
      {markerModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-[26rem] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h3 className="font-bold text-gray-800 text-lg">{markerModal.data.type === 'point' ? '📍 新增點標記' : '🔲 新增範圍標記'}</h3>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <textarea value={markerModal.text} onChange={e => setMarkerModal(prev => ({...prev, text: e.target.value}))} placeholder="輸入現場備註 (必填)..." className="w-full h-28 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"/>
              {markerModal.image && (
                <div className="relative inline-block self-start">
                  <img src={markerModal.image} alt="預覽" className="h-24 rounded-lg border border-gray-200 object-cover shadow-sm" />
                  <button onClick={() => setMarkerModal(prev => ({...prev, image: null}))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm shadow-md hover:bg-red-600 transition">✕</button>
                </div>
              )}
              <div className="flex gap-2 items-center">
                <label className="text-xs bg-gray-50 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition cursor-pointer flex items-center gap-1.5 font-medium border border-gray-200">
                  📷 附加相片 (可選) <input type="file" accept="image/*" className="hidden" onChange={handleModalImageUpload} />
                </label>
              </div>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => { setMarkerModal({ isOpen: false, data: null, text: '', image: null }); setTool('view'); }} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">取消</button>
              <button onClick={saveMarkerFromModal} disabled={!markerModal.text.trim()} className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition disabled:opacity-50 disabled:shadow-none">儲存記錄</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 新增專案 Modal */}
      {projectModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50"><h3 className="font-bold text-gray-800">新增工程項目</h3></div>
            <div className="p-5">
              <input type="text" value={projectModal.name} onChange={e => setProjectModal(prev => ({...prev, name: e.target.value}))} placeholder="輸入專案名稱" className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" autoFocus/>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setProjectModal({ isOpen: false, name: '' })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">取消</button>
              <button onClick={confirmAddProject} disabled={!projectModal.name.trim()} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition disabled:opacity-50">建立</button>
            </div>
          </div>
        </div>
      )}

      {/* 3. 新增分類 Modal */}
      {subModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50"><h3 className="font-bold text-indigo-700">新增分類 / 區域</h3></div>
            <div className="p-5">
              <input type="text" value={subModal.name} onChange={e => setSubModal(prev => ({...prev, name: e.target.value}))} placeholder="例如：1樓大堂" className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" autoFocus/>
            </div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setSubModal({ isOpen: false, name: '' })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">取消</button>
              <button onClick={confirmAddSubcategory} disabled={!subModal.name.trim()} className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50">建立</button>
            </div>
          </div>
        </div>
      )}

      {/* 4. 確認刪除 Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-80 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-red-50 bg-red-50"><h3 className="font-bold text-red-600">確認刪除</h3></div>
            <div className="p-5 text-sm text-gray-700 font-medium">確定要刪除這個標記嗎？此動作無法復原。</div>
            <div className="px-5 py-4 bg-gray-50 flex justify-end gap-3 border-t border-gray-100">
              <button onClick={() => setConfirmModal({ isOpen: false, markerId: null })} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition">取消</button>
              <button onClick={confirmDeleteMarker} className="px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition">確認刪除</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
