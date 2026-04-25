import React, { useState, useRef, useEffect } from 'react';
import { Camera, Image as ImageIcon, Sparkles, Save, RotateCcw, Loader2, AlertCircle, Trash2, Printer, CheckCircle2, ChevronRight, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { geminiService, RecognitionResult, Variation } from './services/geminiService';
import { db, auth } from './lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import html2pdf from 'html2pdf.js';

// --- Types ---
interface MistakeRecord {
  id?: string;
  userId: string;
  imageUrl?: string;
  originalQuestion: string;
  originalAnalysis: string;
  knowledgePoint: string;
  variations: Variation[];
  createdAt: any;
}

// --- Components ---

const Button = ({ children, onClick, disabled, className, variant = 'primary' }: any) => {
  const variants: any = {
    primary: 'bg-primary text-white hover:bg-primary/90 disabled:bg-primary/30 shadow-lg shadow-primary/20',
    secondary: 'bg-white text-gray-700 border border-border hover:bg-gray-50',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100',
    outline: 'bg-transparent border border-primary text-primary hover:bg-primary/5',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-xl font-bold transition-all active:scale-95 flex items-center justify-center gap-2 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'recognition' | 'workbook'>('recognition');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Recognition form state
  const [image, setImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<RecognitionResult | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Workbook state
  const [records, setRecords] = useState<MistakeRecord[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        fetchRecords(u.uid);
      }
    });
    return unsubscribe;
  }, []);

  const fetchRecords = async (userId: string) => {
    try {
      const q = query(
        collection(db, 'mistakes'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MistakeRecord));
      setRecords(data);
    } catch (error) {
      console.error("Error fetching records:", error);
    }
  };

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          const resizedImage = canvas.toDataURL('image/jpeg', 0.7);
          setImage(resizedImage);
          setOcrResult(null);
          setVariations([]);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const startOcr = async () => {
    if (!image) return;
    setLoading(true);
    try {
      const result = await geminiService.recognizeMistake(image);
      setOcrResult(result);
      setMessage({ type: 'success', text: '识别完成！' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const generateVariations = async () => {
    if (!ocrResult) return;
    setLoading(true);
    try {
      const result = await geminiService.generateVariations(ocrResult.question, ocrResult.knowledgePoint);
      setVariations(result);
      setMessage({ type: 'success', text: '变式题生成完成！' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const saveToWorkbook = async () => {
    if (!user || !ocrResult) return;
    setLoading(true);
    try {
      const record: Omit<MistakeRecord, 'id'> = {
        userId: user.uid,
        imageUrl: image || '',
        originalQuestion: ocrResult.question,
        originalAnalysis: ocrResult.analysis,
        knowledgePoint: ocrResult.knowledgePoint,
        variations: variations,
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'mistakes'), record);
      setMessage({ type: 'success', text: '已保存到错题本' });
      fetchRecords(user.uid);
      // Reset form
      setImage(null);
      setOcrResult(null);
      setVariations([]);
    } catch (error: any) {
      setMessage({ type: 'error', text: '保存失败: ' + error.message });
    } finally {
      setLoading(false);
    }
  };

  const deleteRecord = async (id: string) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, 'mistakes', id));
      setRecords(prev => prev.filter(r => r.id !== id));
      setSelectedRecords(prev => prev.filter(sid => sid !== id));
    } catch (error) {
      console.error("Delete failed", error);
    }
  };

  const exportPdf = async () => {
    const selected = records.filter(r => selectedRecords.includes(r.id!));
    if (selected.length === 0) return;

    const element = document.createElement('div');
    element.className = 'p-10 bg-white text-gray-900 font-sans';
    element.innerHTML = `
      <h1 class="text-3xl font-bold text-center mb-8 border-b-2 border-primary pb-4">错题举一反三打印本</h1>
      ${selected.map((r, index) => `
        <div class="mb-10 page-break-inside-avoid">
          <div class="bg-gray-50 p-6 rounded-2xl mb-4 border border-border">
             <div class="text-xs text-primary font-extrabold mb-1 uppercase tracking-widest">知识点：${r.knowledgePoint}</div>
             <div class="font-bold text-lg mb-2 text-[#1E293B]">题目 ${index + 1}（原题）：</div>
             <div class="mt-2 text-sm leading-relaxed whitespace-pre-wrap">${r.originalQuestion}</div>
          </div>
          <div class="ml-6 space-y-8">
            ${r.variations.map((v, vIdx) => `
              <div class="border-l-4 border-primary/20 pl-6 py-2 relative">
                <div class="absolute -left-1 top-0 w-2 h-2 bg-primary rounded-full"></div>
                <div class="font-bold text-[#1E293B] mb-2">变式训练 ${vIdx + 1}：</div>
                <div class="text-sm leading-relaxed whitespace-pre-wrap text-[#334155] mb-4">${v.question}</div>
                <div class="mt-4 pt-4 border-t border-dashed border-border">
                  <div class="text-xs font-extrabold text-gray-900 uppercase tracking-widest mb-1">【正确答案】</div>
                  <div class="text-sm mt-1 whitespace-pre-wrap font-medium">${v.answer}</div>
                  <div class="text-xs font-extrabold mt-4 text-primary uppercase tracking-widest mb-1">【易错解析】</div>
                  <div class="text-sm mt-1 text-gray-600 bg-amber-50 p-3 rounded-lg border border-amber-100 italic leading-relaxed whitespace-pre-wrap">${v.explanation}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <hr class="mt-12 border-border">
        </div>
      `).join('')}
    `;

    const opt = {
      margin: 10,
      filename: `错题本_${new Date().toLocaleDateString()}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
    };

    html2pdf().set(opt).from(element).save();
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F0F2F5] flex flex-col items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8 bg-white p-10 rounded-3xl shadow-xl border border-border"
        >
          <div className="w-20 h-20 bg-primary rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-primary/20">
            <Sparkles className="text-white w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-extrabold text-[#1E293B] tracking-tight tracking-[-0.02em]">SmartPrint.</h1>
            <p className="text-gray-500 font-medium tracking-tight">智能识别错题，生成变式解析，一键打印</p>
          </div>
          <Button onClick={login} className="w-full py-4 text-lg">
            <CheckCircle2 className="w-5 h-5" /> 立即登录开启学习
          </Button>
          <p className="text-xs text-gray-400">登入即代表您同意我们的服务条款</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg-page font-sans text-[#1A1A1A]">
      {/* Sidebar Navigation */}
      <nav className="w-64 bg-[#1E293B] text-white flex-col p-6 hidden md:flex shrink-0">
        <div className="font-extrabold text-2xl mb-10 text-primary flex items-center gap-2">
          <Sparkles className="w-7 h-7" /> SmartPrint.
        </div>
        
        <div className="space-y-2 flex-grow">
          <button 
            onClick={() => setActiveTab('recognition')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'recognition' ? 'bg-primary shadow-lg shadow-primary/20' : 'hover:bg-white/10 opacity-70'}`}
          >
            <Camera className="w-5 h-5" />
            <span className="font-semibold text-sm">错题识别</span>
          </button>
          <button 
            onClick={() => setActiveTab('workbook')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'workbook' ? 'bg-primary shadow-lg shadow-primary/20' : 'hover:bg-white/10 opacity-70'}`}
          >
            <ImageIcon className="w-5 h-5" />
            <span className="font-semibold text-sm">历史错题本</span>
          </button>
        </div>

        <div className="mt-10 pt-10 border-t border-white/10">
          <div className="text-[10px] uppercase opacity-40 font-bold tracking-widest mb-4">最近预览</div>
          <div className="space-y-3">
            {records.slice(0, 3).map(r => (
              <div key={r.id} className="text-xs opacity-60 truncate font-medium hover:opacity-100 cursor-pointer">
                [{r.knowledgePoint.split(' ')[0]}] {r.originalQuestion.slice(0, 15)}...
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-10 flex items-center gap-3">
          <img src={user.photoURL || ''} className="w-9 h-9 rounded-full border border-white/20" />
          <div className="flex-1 min-w-0">
             <div className="text-sm font-bold truncate">{user.displayName}</div>
             <div className="text-[10px] opacity-50">已上传 {records.length} 道题目</div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-grow flex flex-col p-4 md:p-8 gap-6 overflow-y-auto h-screen">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-[#1E293B]">
              {activeTab === 'recognition' ? '错题识别 & 举一反三' : '我的错题本'}
            </h1>
            <p className="text-sm text-gray-500 font-medium">
              {activeTab === 'recognition' 
                ? (ocrResult ? `已识别核心考点：${ocrResult.knowledgePoint}` : '请上传错题图片开始智能分析')
                : `共保存了 ${records.length} 条复习记录`
              }
            </p>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap">
            {activeTab === 'recognition' && image && (
              <>
                <Button variant="secondary" onClick={() => setImage(null)} className="h-10 text-xs">重新拍照</Button>
                {ocrResult && (
                  <>
                    <Button variant="secondary" onClick={saveToWorkbook} disabled={loading} className="h-10 text-xs">保存至错题库</Button>
                    <Button onClick={exportPdf} className="h-10 text-xs bg-accent hover:bg-accent/90">生成PDF打印</Button>
                  </>
                )}
              </>
            )}
            {activeTab === 'workbook' && selectedRecords.length > 0 && (
              <Button onClick={exportPdf} className="h-10 text-xs bg-accent hover:bg-accent/90 shadow-lg shadow-accent/20 animate-in fade-in zoom-in">
                <Printer className="w-4 h-4" /> 生成PDF打印 ({selectedRecords.length})
              </Button>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'recognition' ? (
            <motion.div
              key="recognition"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-12 gap-4 flex-grow pb-24 md:pb-0"
            >
              {/* Left Column (Input & Analysis) */}
              <div className="col-span-12 lg:col-span-5 flex flex-col gap-4">
                {/* Image Input/OCR Card */}
                <div className="bento-card flex-grow min-h-[350px]">
                  <div className="card-label">原题识别内容</div>
                  {!image ? (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-grow border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/50 transition-all group"
                    >
                      <div className="p-4 bg-primary/10 rounded-full text-primary group-hover:scale-110 transition-transform">
                        <Camera className="w-8 h-8" />
                      </div>
                      <div className="text-center px-4">
                        <p className="font-bold text-gray-700 text-sm">点击拍照或上传图片</p>
                        <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">支持全学科符号识别</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 h-full overflow-hidden">
                      <div className="relative rounded-xl overflow-hidden bg-gray-50 border border-border shrink-0 max-h-[300px]">
                        <img src={image} className="w-full h-full object-contain" />
                        {!ocrResult && (
                          <div className="absolute inset-0 bg-black/5 flex items-center justify-center backdrop-blur-[2px]">
                             <Button onClick={startOcr} disabled={loading} className="shadow-2xl">
                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                                开始智能识别
                             </Button>
                          </div>
                        )}
                        {ocrResult && (
                          <button 
                            onClick={() => setImage(null)}
                            className="absolute top-2 right-2 p-1.5 bg-white/80 rounded-full text-red-500 hover:bg-white shadow-sm"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {ocrResult && (
                        <div className="bg-[#F8FAFC] p-3 rounded-lg border border-border flex-grow overflow-y-auto">
                          <textarea 
                            value={ocrResult.question}
                            onChange={(e) => setOcrResult({ ...ocrResult, question: e.target.value })}
                            className="w-full h-full bg-transparent border-none focus:ring-0 text-sm leading-relaxed font-medium text-[#334155] resize-none"
                            placeholder="识别出的题目内容..."
                          />
                        </div>
                      )}
                    </div>
                  )}
                  <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                </div>

                {/* Analysis & Knowledge Point Card */}
                <div className="bento-card">
                  <div className="card-label">知识点深度解析</div>
                  {ocrResult ? (
                    <div className="flex flex-col h-full space-y-4">
                      <div className="flex flex-wrap gap-2">
                         <div className="analysis-pill flex items-center gap-1">
                            考点：
                            <input 
                              value={ocrResult.knowledgePoint}
                              onChange={(e) => setOcrResult({ ...ocrResult, knowledgePoint: e.target.value })}
                              className="bg-transparent border-none focus:ring-0 p-0 text-xs font-bold inline-block"
                            />
                         </div>
                      </div>
                      <div className="error-analysis flex-grow">
                         <strong>易错点警告：</strong>
                         <textarea 
                            value={ocrResult.analysis}
                            onChange={(e) => setOcrResult({ ...ocrResult, analysis: e.target.value })}
                            className="w-full bg-transparent border-none focus:ring-0 p-0 mt-2 text-sm leading-relaxed resize-none h-32"
                            placeholder="模型对题目的易错点分析..."
                         />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-300 opacity-50">
                      <AlertCircle className="w-8 h-8 mb-2" />
                      <p className="text-xs font-bold">请先识别题目以提取考点</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (Results & Variations) */}
              <div className="col-span-12 lg:col-span-7 flex flex-col gap-4">
                {/* Stats/Quick Actions Card */}
                <div className="bento-card flex-row items-center justify-around py-6 shrink-0">
                  <div className="text-center px-4">
                    <div className="text-2xl font-bold text-[#1E293B]">{variations.length}</div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">已生成题目</div>
                  </div>
                  <div className="h-10 w-[1px] bg-border"></div>
                  <div className="text-center px-4">
                    <div className="text-2xl font-bold text-accent">{ocrResult ? '高' : '-'}</div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">考查契合度</div>
                  </div>
                  <div className="h-10 w-[1px] bg-border"></div>
                  <div className="px-4">
                    <Button onClick={generateVariations} disabled={loading || !ocrResult} className="text-xs py-2 px-6">
                      {variations.length > 0 ? '换一组题目' : '生成变式对标题'}
                    </Button>
                  </div>
                </div>

                {/* Variations Card */}
                <div className="bento-card flex-grow overflow-y-auto">
                  <div className="card-label">智能举一反三 (基于相同考点逻辑)</div>
                  {variations.length > 0 ? (
                    <div className="flex flex-col gap-4">
                      {variations.map((v, i) => (
                        <div key={i} className="var-box group">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-extrabold text-primary opacity-40">VARIATION 0{i+1}</span>
                            </div>
                            <div className="text-sm font-bold text-[#334155] leading-relaxed whitespace-pre-wrap">{v.question}</div>
                          </div>
                          <details className="mt-4">
                            <summary className="list-none cursor-pointer text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                              显示答案与解析 <ChevronRight className="w-3 h-3 transition-transform" />
                            </summary>
                            <div className="mt-3 p-3 bg-white border border-border rounded-lg text-xs space-y-3 shadow-sm animate-in slide-in-from-top-2">
                               <div>
                                  <div className="text-gray-400 font-bold uppercase tracking-widest text-[9px] mb-1">正确答案</div>
                                  <div className="text-gray-900 font-bold">{v.answer}</div>
                               </div>
                               <div>
                                  <div className="text-accent font-bold uppercase tracking-widest text-[9px] mb-1">易错点解析</div>
                                  <div className="text-gray-600 leading-relaxed italic">{v.explanation}</div>
                               </div>
                            </div>
                          </details>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center flex-grow py-20 text-gray-300 opacity-40">
                      <Sparkles className="w-16 h-16 mb-4" />
                      <p className="text-sm font-bold tracking-tight">点击上方按钮，AI 即可为您精准生成 3 道变式练习</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="workbook"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              <div className="flex items-center justify-between px-2">
                  <button 
                  onClick={() => setSelectedRecords(selectedRecords.length === records.length ? [] : records.map(r => r.id!))}
                  className="text-xs font-bold text-primary uppercase tracking-widest hover:underline"
                  >
                    {selectedRecords.length === records.length ? '取消全选' : '全部选择'}
                  </button>
              </div>

              {records.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-2xl border border-border border-dashed">
                  <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-200 mb-4">
                    <Save className="w-10 h-10" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-400">尚无任何错题记录</h3>
                  <p className="text-sm text-gray-300 mt-1">开始你的智能化错题复习之旅吧</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {records.map((record) => (
                    <motion.div 
                      key={record.id} 
                      layout
                      className={`bento-card group relative cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] ${selectedRecords.includes(record.id!) ? 'border-primary ring-1 ring-primary/50 overflow-hidden' : ''}`}
                      onClick={() => {
                        if (selectedRecords.includes(record.id!)) {
                          setSelectedRecords(selectedRecords.filter(id => id !== record.id));
                        } else {
                          setSelectedRecords([...selectedRecords, record.id!]);
                        }
                      }}
                    >
                      {selectedRecords.includes(record.id!) && (
                        <div className="absolute top-0 right-0 bg-primary text-white p-1 rounded-bl-lg z-10">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      )}
                      
                      <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between mb-3 min-h-[24px]">
                          <span className="text-[10px] font-extrabold text-primary bg-primary/10 px-2 py-1 rounded truncate max-w-[120px]">
                            {record.knowledgePoint}
                          </span>
                          <span className="text-[10px] text-gray-400 font-bold shrink-0">
                            {record.createdAt?.toDate ? record.createdAt.toDate().toLocaleDateString() : ''}
                          </span>
                        </div>
                        
                        <div className="text-sm font-bold text-[#1E293B] line-clamp-3 mb-4 leading-relaxed flex-grow">
                          {record.originalQuestion}
                        </div>
                        
                        <div className="mt-auto pt-4 border-t border-border flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-accent" />
                            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">{record.variations.length} 变式</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRecord(record.id!);
                            }} 
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-border px-8 py-3 flex justify-around items-center z-50">
        <button 
          onClick={() => setActiveTab('recognition')}
          className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'recognition' ? 'text-primary scale-110' : 'text-gray-400'}`}
        >
          <div className={`p-2 rounded-xl ${activeTab === 'recognition' ? 'bg-primary text-white shadow-lg shadow-primary/20' : ''}`}>
            <Camera className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider">识别</span>
        </button>
        <button 
          onClick={() => setActiveTab('workbook')}
          className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'workbook' ? 'text-primary scale-110' : 'text-gray-400'}`}
        >
          <div className={`p-2 rounded-xl ${activeTab === 'workbook' ? 'bg-primary text-white shadow-lg shadow-primary/20' : ''}`}>
            <ImageIcon className="w-6 h-6" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider">错题本</span>
        </button>
      </nav>

      {/* Auth State Overlay */}
      {!user && (
        <div className="fixed inset-0 bg-bg-page/80 backdrop-blur-md z-[100] flex items-center justify-center px-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white p-8 rounded-3xl shadow-2xl border border-border max-w-sm w-full text-center"
          >
             <div className="w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Sparkles className="text-white w-8 h-8" />
             </div>
             <h2 className="text-2xl font-bold text-[#1E293B] mb-2 font-display">SmartPrint.</h2>
             <p className="text-sm text-gray-500 mb-8 leading-relaxed">您的智能错题打印专家。<br/>请先登录以同步您的学习进度。</p>
             <Button onClick={login} className="w-full py-4 text-sm font-bold uppercase tracking-widest">
               通过 Google 账户登录
             </Button>
          </motion.div>
        </div>
      )}

      {/* Notifications */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-24 md:bottom-10 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl z-[60] flex items-center gap-3 text-sm font-bold tracking-tight ${message.type === 'success' ? 'bg-[#10B981] text-white' : 'bg-[#EF4444] text-white'}`}
          >
            {message.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </motion.div>
        )}
      </AnimatePresence>

      <ToastTimeout message={message} setMessage={setMessage} />
    </div>
  );
}

function ToastTimeout({ message, setMessage }: any) {
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [message, setMessage]);
  return null;
}
