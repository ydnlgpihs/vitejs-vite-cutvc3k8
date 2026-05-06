// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

// ==========================================
// 1. Firebase 設定 (請務必填入你的 Config)
// ==========================================
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

const validFirebaseConfig = Object.keys(firebaseConfig).length > 0 ? firebaseConfig : {};
const app = initializeApp(validFirebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app); 
const appId = "engineering-progress-system";

// ==========================================
// 2. 輔助函數：前端壓縮圖片
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
  const [user, setUser] = useState(null);
  const [pdfReady, setPdfReady] = useState(false);
  
  const [projects, setProjects] = useState([]);
  const [subcategories, setSubcategories] = useState([]); 
  const [markers, setMarkers] = useState({}); 
  
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeSubcategoryId, setActiveSubcategoryId] = useState(""); 
  
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [tool, setTool] = useState('view'); 
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentDraw, setCurrentDraw] = useState(null);

  // 狀態管理：側邊欄 (手機版) 及上傳進度
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 768);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const [markerModal, setMarkerModal] = useState({ isOpen: false, data: null, text: '', image: null });
  const [projectModal, setProjectModal] = useState({ isOpen: false, name: '' });
  const [subModal, setSubModal] = useState({ isOpen: false, name: '' }); 
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, markerId: null });

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const fileInputRef = useRef(null);

  // 監聽螢幕大小，自動開關側邊欄
  useEffect(() => {
    const handleResize = () => setIsSidebarOpen(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Firebase Auth
  useEffect(() => {
    const initAuth = async () => {
      try { await signInAnonymously(auth); } 
      catch (error) { console.error("登入失敗:", error); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Firebase DB 監聽
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
    });

    const unsubSubcats = onSnapshot(subcatsRef, (snapshot) => {
      const subs = [];
      snapshot.forEach(doc => subs.push(doc.data()));
      setSubcategories(subs);
    });

    const unsubMarkers = onSnapshot(markersRef, (snapshot) => {
      const marks = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!marks[data.projectId]) marks[data.projectId] = [];
        marks[data.projectId].push(data);
      });
      setMarkers(marks);
    });

    return () => { unsubProjects(); unsubSubcats(); unsubMarkers(); };
  }, [user, activeProjectId]);

  // 自動維護子分類
  useEffect(() => {
    if (!activeProjectId || !user) return;
    const projectSubs = subcategories.filter(s => s.projectId === activeProjectId);
    if (projectSubs.length === 0 && subcategories.length > 0) {
      const defaultSub = { id: Date.now().toString(), projectId: activeProjectId, name: '預設區域' };
      setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', defaultSub.id), defaultSub);
    } else if (projectSubs.length > 0 && !projectSubs.find(s => s.id === activeSubcategoryId)) {
      setActiveSubcategoryId(projectSubs[0].id);
    }
  }, [activeProjectId, subcategories, activeSubcategoryId, user]);

  // 初始化 PDF.js
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

  // 渲染 PDF
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current || !overlayRef.current) return;
      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: window.innerWidth < 768 ? 1.0 : 1.5 }); // 手機縮小比例
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      overlayRef.current.style.width = `${viewport.width}px`;
      overlayRef.current.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    };
    renderPage();
  }, [pdfDoc, currentPage]);

  // ==========================================
  // 自動拉取雲端 PDF 圖紙
  // ==========================================
  useEffect(() => {
    const loadCloudPdf = async () => {
      if (!activeSubcategoryId || !pdfReady) return;
      const currentSub = subcategories.find(s => s.id === activeSubcategoryId);
      
      // 如果雲端有 PDF URL，就自動下載渲染
      if (currentSub && currentSub.pdfUrl) {
        setIsUploading(true);
        setUploadProgress(100); // 視覺提示正在載入
        try {
          const loadingTask = window.pdfjsLib.getDocument(currentSub.pdfUrl);
          const pdf = await loadingTask.promise;
          setPdfDoc(pdf);
          setTotalPages(pdf.numPages);
          setCurrentPage(1);
        } catch (error) {
          console.error("雲端圖紙載入失敗:", error);
          alert("雲端圖紙載入失敗，可能檔案已被刪除。");
          setPdfDoc(null);
        } finally {
          setIsUploading(false);
          setUploadProgress(0);
        }
      } else {
        // 如果切換到沒有圖紙的區域，清空畫面
        setPdfDoc(null);
      }
    };
    loadCloudPdf();
  }, [activeSubcategoryId, subcategories, pdfReady]);

  // ==========================================
  // 上傳 PDF 至 Firebase Storage 並綁定到區域
  // ==========================================
  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !pdfReady || !activeSubcategoryId) return;

    // 1. 先在本機預覽 (極速體驗)
    const fileUrl = URL.createObjectURL(file);
    try {
      const loadingTask = window.pdfjsLib.getDocument(fileUrl);
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
    } catch (error) { console.error("預覽載入失敗:", error); }

    // 2. 上傳至 Firebase Storage
    setIsUploading(true);
    const storageRef = ref(storage, `blueprints/${activeSubcategoryId}_${Date.now()}.pdf`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      }, 
      (error) => {
        console.error("上傳失敗:", error);
        alert("圖紙上傳雲端失敗，請檢查 Firebase Storage Rules 是否允許寫入。");
        setIsUploading(false);
      }, 
      async () => {
        // 3. 上傳成功，將 URL 寫入 Firestore 的子分類中
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', activeSubcategoryId), {
          ...subcategories.find(s => s.id === activeSubcategoryId),
          pdfUrl: downloadURL
        });
        setIsUploading(false);
        setUploadProgress(0);
        alert("圖紙已成功同步至雲端，其他同事進入此區域會自動看見。");
      }
    );
  };

  // --- CRUD 操作 ---
  const confirmAddProject = async () => {
    if (projectModal.name.trim() && user) {
      const newProjectId = Date.now().toString();
      const newProject = { id: newProjectId, name: projectModal.name.trim() };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', newProject.id), newProject);
      setActiveProjectId(newProject.id);
      const defaultSub = { id: Date.now().toString() + '_sub', projectId: newProjectId, name: '一般區域', pdfUrl: null };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', defaultSub.id), defaultSub);
    }
    setProjectModal({ isOpen: false, name: '' });
  };

  const confirmAddSubcategory = async () => {
    if (subModal.name.trim() && user && activeProjectId) {
      const newSub = { id: Date.now().toString(), projectId: activeProjectId, name: subModal.name.trim(), pdfUrl: null };
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'subcategories', newSub.id), newSub);
      setActiveSubcategoryId(newSub.id);
    }
    setSubModal({ isOpen: false, name: '' });
  };

  // --- 畫布互動 ---
  const handleOverlayMouseDown = (e) => {
    if (tool === 'view' || !activeSubcategoryId) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    if (tool === 'point') {
      setMarkerModal({ isOpen: true, data: { type: 'point', x, y, page: currentPage }, text: '', image: null });
    } else if (tool === 'area') {
      setIsDrawing(true); setDrawStart({ x, y }); setCurrentDraw({ x, y, w: 0, h: 0 });
    }
  };

  const handleOverlayMouseMove = (e) => {
    if (!isDrawing || tool !== 'area') return;
    const rect = overlayRef.current.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;
    setCurrentDraw({ x: Math.min(drawStart.x, currentX), y: Math.min(drawStart.y, currentY), w: Math.abs(currentX - drawStart.x), h: Math.abs(currentY - drawStart.y) });
  };

  const handleOverlayMouseUp = () => {
    if (!isDrawing || tool !== 'area') return;
    setIsDrawing(false);
    if (currentDraw.w > 1 && currentDraw.h > 1) {
      setMarkerModal({ isOpen: true, data: { type: 'area', x: currentDraw.x, y: currentDraw.y, w: currentDraw.w, h: currentDraw.h, page: currentPage }, text: '', image: null });
    }
    setCurrentDraw(null);
  };

  const handleModalImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const compressed = await compressImage(file); setMarkerModal(prev => ({ ...prev, image: compressed })); } 
    catch (error) { console.error(error); }
  };

  const saveMarkerFromModal = async () => {
    if (!user || !markerModal.text.trim() || !activeSubcategoryId) return;
    const newMarker = { id: Date.now().toString(), projectId: activeProjectId, subcategoryId: activeSubcategoryId, text: markerModal.text, image: markerModal.image, ...markerModal.data };
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'markers', newMarker.id), newMarker);
    setMarkerModal({ isOpen: false, data: null, text: '', image: null });
    setTool('view');
  };

  const currentProjectSubs = subcategories.filter(s => s.projectId === activeProjectId);
  const currentProjectMarkers = (markers[activeProjectId] || []).filter(m => m.page === currentPage && m.subcategoryId === activeSubcategoryId);

  if (!pdfReady) return <div className="flex h-screen items-center justify-center bg-gray-50">引擎準備中...</div>;

  return (
    <div className="flex h-screen w-full bg-gray-100 font-sans text-gray-800 overflow-hidden relative">
      
      {/* ================= 側邊欄 (手機版自動隱藏) ================= */}
      {/* 遮罩 (手機版用) */}
      {isSidebarOpen && window.innerWidth <= 768 && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-20" onClick={() => setIsSidebarOpen(false)} />
      )}
      
      <div className={`absolute md:relative z-30 h-full w-72 md:w-80 bg-white border-r border-gray-200 flex flex-col shadow-xl md:shadow-sm transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 border-b border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-lg font-bold text-gray-800">進度管理系統</h1>
            {/* 手機版關閉側邊欄按鈕 */}
            <button className="md:hidden text-gray-500 font-bold text-xl px-2" onClick={() => setIsSidebarOpen(false)}>×</button>
          </div>
          
          <div className="mb-4">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-gray-500">專案項目</span>
              <button onClick={() => setProjectModal({ isOpen: true, name: '' })} className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded">+ 新增</button>
            </div>
            <select value={activeProjectId} onChange={(e) => setActiveProjectId(e.target.value)} className="w-full border rounded p-1.5 text-sm">
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-semibold text-gray-500">圖紙區域</span>
              <button onClick={() => setSubModal({ isOpen: true, name: '' })} disabled={!activeProjectId} className="text-[10px] bg-indigo-500 text-white px-2 py-0.5 rounded disabled:opacity-50">+ 新增</button>
            </div>
            <select value={activeSubcategoryId} onChange={(e) => setActiveSubcategoryId(e.target.value)} className="w-full border rounded p-1.5 text-sm">
              {currentProjectSubs.map(s => <option key={s.id} value={s.id}>{s.name} {s.pdfUrl ? '📄' : ''}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-white">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">當前頁面標記 ({currentProjectMarkers.length})</h2>
          <div className="space-y-3">
            {currentProjectMarkers.map(marker => (
              <div key={marker.id} className="bg-gray-50 border border-gray-200 rounded p-3 relative group">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1.5 ${marker.type === 'point' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                  {marker.type === 'point' ? '📍' : '🔲'}
                </span>
                <p className="text-sm text-gray-800 break-words">{marker.text}</p>
                {marker.image && <img src={marker.image} className="mt-2 rounded max-h-32 object-cover w-full" />}
                <button onClick={() => setConfirmModal({ isOpen: true, markerId: marker.id })} className="text-red-400 absolute top-2 right-2 p-1">✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ================= 右側主要工作區 ================= */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-300">
        
        {/* 頂部工具列 */}
        <div className="h-14 bg-white border-b flex items-center justify-between px-2 md:px-4 shadow-sm z-10 w-full overflow-x-auto whitespace-nowrap scrollbar-hide">
          <div className="flex items-center space-x-2 md:space-x-4">
            {/* 漢堡按鈕 (僅手機顯示) */}
            <button className="md:hidden p-2 text-gray-600" onClick={() => setIsSidebarOpen(true)}>
              ☰
            </button>

            <input type="file" accept="application/pdf" className="hidden" ref={fileInputRef} onChange={handlePdfUpload} />
            
            <div className="flex flex-col relative">
              <button onClick={() => fileInputRef.current.click()} disabled={isUploading || !activeSubcategoryId} className="bg-gray-800 text-white px-3 py-1.5 rounded text-xs md:text-sm disabled:opacity-50">
                {isUploading ? '雲端同步中...' : '更換雲端圖紙'}
              </button>
              {/* 上傳進度條 */}
              {isUploading && (
                <div className="absolute -bottom-1 left-0 h-1 bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }}></div>
              )}
            </div>

            {pdfDoc && (
              <div className="flex items-center bg-gray-100 rounded px-1 text-xs md:text-sm">
                <button disabled={currentPage <= 1} onClick={() => setCurrentPage(prev => prev - 1)} className="px-2 py-1 disabled:opacity-50">◀</button>
                <span className="font-bold px-2">{currentPage}/{totalPages}</span>
                <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(prev => prev + 1)} className="px-2 py-1 disabled:opacity-50">▶</button>
              </div>
            )}
          </div>

          <div className="flex items-center bg-gray-100 p-1 rounded ml-2">
            <button onClick={() => setTool('view')} className={`px-2 md:px-3 py-1 md:py-1.5 rounded text-xs md:text-sm ${tool === 'view' ? 'bg-white shadow font-bold text-blue-600' : 'text-gray-600'}`}>✋</button>
            <button onClick={() => setTool('point')} disabled={!activeSubcategoryId || !pdfDoc} className={`px-2 md:px-3 py-1 md:py-1.5 rounded text-xs md:text-sm disabled:opacity-50 ${tool === 'point' ? 'bg-white shadow font-bold text-red-600' : 'text-gray-600'}`}>📍</button>
            <button onClick={() => setTool('area')} disabled={!activeSubcategoryId || !pdfDoc} className={`px-2 md:px-3 py-1 md:py-1.5 rounded text-xs md:text-sm disabled:opacity-50 ${tool === 'area' ? 'bg-white shadow font-bold text-orange-600' : 'text-gray-600'}`}>🔲</button>
          </div>
        </div>

        {/* PDF 圖紙層 */}
        <div className="flex-1 overflow-auto p-2 md:p-6 relative">
          {!pdfDoc ? (
            <div className="text-gray-500 mt-20 flex flex-col items-center px-4 text-center">
              <p className="font-medium text-lg">無圖紙</p>
              <p className="text-sm text-gray-400 mt-2">請選擇有圖紙的區域，或上傳新圖紙至當前區域。</p>
            </div>
          ) : (
            <div className="relative shadow-xl bg-white border border-gray-200 w-max m-auto">
              <canvas ref={canvasRef} className="block" />
              <div ref={overlayRef} className={`absolute top-0 left-0 ${tool !== 'view' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`} onMouseDown={handleOverlayMouseDown} onMouseMove={handleOverlayMouseMove} onMouseUp={handleOverlayMouseUp} onMouseLeave={handleOverlayMouseUp}>
                
                {currentProjectMarkers.map(m => {
                  if (m.type === 'point') return <div key={m.id} className="absolute w-4 md:w-5 h-4 md:h-5 bg-red-500 rounded-full border-[2px] md:border-[3px] border-white shadow-md transform -translate-x-1/2 -translate-y-1/2" style={{ left: `${m.x}%`, top: `${m.y}%` }}/>;
                  if (m.type === 'area') return <div key={m.id} className="absolute border-[2px] md:border-[3px] border-orange-500 bg-orange-500 bg-opacity-20" style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w}%`, height: `${m.h}%` }}/>;
                  return null;
                })}

                {isDrawing && currentDraw && tool === 'area' && <div className="absolute border-[2px] border-blue-500 border-dashed bg-blue-500 bg-opacity-30" style={{ left: `${currentDraw.x}%`, top: `${currentDraw.y}%`, width: `${currentDraw.w}%`, height: `${currentDraw.h}%` }}/>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= 彈出視窗群組 ================= */}
      {/* 1. 標記 Modal */}
      {markerModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b bg-gray-50"><h3 className="font-bold">{markerModal.data.type === 'point' ? '📍 新增點標記' : '🔲 新增範圍標記'}</h3></div>
            <div className="p-4 flex flex-col gap-3">
              <textarea value={markerModal.text} onChange={e => setMarkerModal(prev => ({...prev, text: e.target.value}))} placeholder="輸入現場備註..." className="w-full h-24 border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"/>
              {markerModal.image && <div className="relative inline-block self-start"><img src={markerModal.image} className="h-20 rounded border object-cover"/><button onClick={() => setMarkerModal(prev => ({...prev, image: null}))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs">✕</button></div>}
              <label className="text-xs bg-gray-100 text-gray-700 px-3 py-2 rounded hover:bg-gray-200 flex items-center gap-1 font-medium border w-max">📷 附加相片 <input type="file" accept="image/*" className="hidden" onChange={handleModalImageUpload}/></label>
            </div>
            <div className="p-4 bg-gray-50 flex justify-end gap-2 border-t">
              <button onClick={() => { setMarkerModal({ isOpen: false, data: null, text: '', image: null }); setTool('view'); }} className="px-4 py-2 text-sm font-medium text-gray-600 rounded bg-white border">取消</button>
              <button onClick={saveMarkerFromModal} disabled={!markerModal.text.trim()} className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded disabled:opacity-50">儲存</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 專案/分類 Modal (共用版面邏輯省略，維持原樣) */}
      {/* 由於空間限制，此處僅提供核心邏輯，Modal UI 與上一版相同，請保留之前寫的 Project/Sub Modal 代碼 */}
      {projectModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col"><div className="p-4 border-b bg-gray-50"><h3 className="font-bold">新增專案</h3></div><div className="p-4"><input type="text" value={projectModal.name} onChange={e => setProjectModal(prev => ({...prev, name: e.target.value}))} className="w-full border rounded p-2 text-sm outline-none" autoFocus/></div><div className="p-4 bg-gray-50 flex justify-end gap-2 border-t"><button onClick={() => setProjectModal({ isOpen: false, name: '' })} className="px-4 py-2 text-sm bg-white border rounded">取消</button><button onClick={confirmAddProject} disabled={!projectModal.name.trim()} className="px-4 py-2 text-sm text-white bg-blue-600 rounded disabled:opacity-50">建立</button></div></div></div>
      )}
      {subModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col"><div className="p-4 border-b bg-gray-50"><h3 className="font-bold">新增區域</h3></div><div className="p-4"><input type="text" value={subModal.name} onChange={e => setSubModal(prev => ({...prev, name: e.target.value}))} className="w-full border rounded p-2 text-sm outline-none" autoFocus/></div><div className="p-4 bg-gray-50 flex justify-end gap-2 border-t"><button onClick={() => setSubModal({ isOpen: false, name: '' })} className="px-4 py-2 text-sm bg-white border rounded">取消</button><button onClick={confirmAddSubcategory} disabled={!subModal.name.trim()} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded disabled:opacity-50">建立</button></div></div></div>
      )}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col"><div className="p-4 border-b bg-red-50"><h3 className="font-bold text-red-600">確認刪除</h3></div><div className="p-4 text-sm">確定要刪除嗎？</div><div className="p-4 bg-gray-50 flex justify-end gap-2 border-t"><button onClick={() => setConfirmModal({ isOpen: false, markerId: null })} className="px-4 py-2 text-sm bg-white border rounded">取消</button><button onClick={confirmDeleteMarker} className="px-4 py-2 text-sm text-white bg-red-600 rounded">刪除</button></div></div></div>
      )}
    </div>
  );
}
