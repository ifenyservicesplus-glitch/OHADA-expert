import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
  Send, 
  Bot, 
  User, 
  Table as TableIcon, 
  FileText, 
  Scale, 
  ChevronRight,
  Calculator,
  BookOpen,
  MessageSquare,
  Plus,
  Trash2,
  Paperclip,
  X,
  File
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const SYSTEM_INSTRUCTION = `Vous êtes un expert comptable spécialisé dans le Système Comptable OHADA (SYSCOHADA) révisé.
Votre mission est d'assister les utilisateurs en répondant à leurs questions techniques avec précision, en vous basant sur le guide d'application du SYSCOHADA.

RÈGLES DE RÉPONSE :
1. Expertise : Répondez comme un consultant expert, avec un ton professionnel et didactique.
2. Structure : Utilisez des tableaux Markdown lorsque cela est pertinent pour présenter des écritures comptables, des plans d'amortissement ou des comparaisons de comptes.
3. Références : Donnez systématiquement les références de la loi (Acte Uniforme relatif au droit comptable, articles spécifiques) ou les numéros de comptes OHADA concernés.
4. Clarté : Expliquez les concepts complexes (ex: amortissement dégressif, juste valeur, contrats pluri-exercices) de manière simple mais rigoureuse.
5. Langue : Répondez exclusivement en français.

CONTEXTE DU GUIDE (SYSCOHADA RÉVISÉ) :
- Le plan de comptes est subdivisé en classes : 1 à 5 pour le bilan (situation), 6 à 8 pour le résultat (gestion).
- Classe 1 : Ressources stables | Classe 2 : Actif immobilisé | Classe 3 : Stocks | Classe 4 : Tiers | Classe 5 : Trésorerie
- Classe 6 : Charges (Activités ordinaires) | Classe 7 : Produits (Activités ordinaires) | Classe 8 : Charges et Produits HAO
- Importance de la distinction entre Actifs (usage durable > 1 an) et Charges.
- Méthodes d'amortissement : Linéaire, Dégressif à taux décroissant (SOFTY), Unités d'œuvre.

Si une question accompagne un fichier (image), analysez le contenu du fichier pour fournir une réponse comptable pertinente.`;

interface Attachment {
  name: string;
  type: string;
  data: string; // base64
}

interface Message {
  role: 'user' | 'model';
  content: string;
  attachment?: Attachment;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
}

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const saved = localStorage.getItem('ohada_chats');
    return saved ? JSON.parse(saved) : [{ 
      id: 'default', 
      title: 'Nouvelle conversation', 
      messages: [], 
      createdAt: Date.now() 
    }];
  });
  
  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem('ohada_active_chat') || 'default';
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeChat = conversations.find(c => c.id === activeId) || conversations[0];

  useEffect(() => {
    localStorage.setItem('ohada_chats', JSON.stringify(conversations));
    localStorage.setItem('ohada_active_chat', activeId);
  }, [conversations, activeId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeChat.messages, isLoading, scrollToBottom]);

  const startNewChat = () => {
    const newId = Date.now().toString();
    const newChat: Conversation = {
      id: newId,
      title: 'Nouvelle conversation',
      messages: [],
      createdAt: Date.now()
    };
    setConversations(prev => [newChat, ...prev]);
    setActiveId(newId);
  };

  const resetHistory = () => {
    if (confirm("Êtes-vous sûr de vouloir supprimer tout l'historique ?")) {
      const defaultChat: Conversation = {
        id: 'default',
        title: 'Nouvelle conversation',
        messages: [],
        createdAt: Date.now()
      };
      setConversations([defaultChat]);
      setActiveId('default');
      localStorage.removeItem('ohada_chats');
      localStorage.removeItem('ohada_active_chat');
    }
  };

  const deleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConversations(prev => {
      const filtered = prev.filter(c => c.id !== id);
      if (filtered.length === 0) {
        return [{ id: 'default', title: 'Nouvelle conversation', messages: [], createdAt: Date.now() }];
      }
      return filtered;
    });
    if (activeId === id) setActiveId(conversations[0].id);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachment({
        name: file.name,
        type: file.type,
        data: (reader.result as string).split(',')[1]
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !attachment) || isLoading) return;

    const userMessage: Message = { 
      role: 'user', 
      content: input || (attachment ? `Fichier joint : ${attachment.name}` : ''),
      attachment: attachment || undefined
    };

    const updatedMessages = [...activeChat.messages, userMessage];
    
    // Update local state immediately
    setConversations(prev => prev.map(c => 
      c.id === activeId 
        ? { 
            ...c, 
            messages: updatedMessages,
            title: c.messages.length === 0 ? (input.slice(0, 30) || attachment?.name || 'Chat sans titre') : c.title
          } 
        : c
    ));

    setInput('');
    setAttachment(null);
    setIsLoading(true);

    try {
      const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp", 
        systemInstruction: SYSTEM_INSTRUCTION 
      });

      const parts: any[] = [{ text: input || "Analysez ce fichier." }];
      if (attachment && attachment.type.startsWith('image/')) {
        parts.push({
          inlineData: {
            mimeType: attachment.type,
            data: attachment.data
          }
        });
      }

      const result = await model.generateContent({
        contents: [{ role: 'user', parts }]
      });

      const modelResponse = result.response.text();
      
      setConversations(prev => prev.map(c => 
        c.id === activeId 
          ? { ...c, messages: [...c.messages, { role: 'model', content: modelResponse || 'Désolé, je n\'ai pas pu générer de réponse.' }] } 
          : c
      ));
    } catch (error) {
      console.error("Gemini Error:", error);
      setConversations(prev => prev.map(c => 
        c.id === activeId 
          ? { ...c, messages: [...c.messages, { role: 'model', content: "Une erreur est survenue. L'analyse des fichiers volumineux peut nécessiter plus de temps ou un format supporté (Images)." }] } 
          : c
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const frequentTopics = [
    { label: "AUDCIF - Article 45", sub: "Amortissements", icon: BookOpen },
    { label: "Syscohada Révisé", sub: "Guide Application", icon: Calculator },
    { label: "Nomenclature PCE", sub: "Plan de Comptes", icon: FileText },
  ];

  return (
    <div className="flex w-full h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden" id="app_root">
      {/* Sidebar Navigation */}
      <aside className="hidden lg:flex w-72 bg-slate-900 text-white flex-col border-r border-slate-800 shrink-0" id="main_sidebar">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
            <h1 className="text-lg font-bold tracking-tight">OHADA Expert+</h1>
          </div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Cabinet Virtuel</p>
        </div>

        <div className="p-4">
          <button 
            onClick={startNewChat}
            className="flex items-center justify-center w-full gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-900/50 active:scale-95"
            id="new_chat_btn"
          >
            <Plus className="w-4 h-4" />
            NOUVEL DOSSIER
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-6 overflow-y-auto custom-scrollbar">
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Dossiers Récents</p>
              <button 
                onClick={resetHistory}
                className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors"
                title="Vider l'historique"
                id="reset_history_btn"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
            <ul className="space-y-1">
              {conversations.map((chat) => (
                <li 
                  key={chat.id}
                  onClick={() => setActiveId(chat.id)}
                  className={`group flex items-center justify-between p-2.5 rounded-lg transition-all cursor-pointer border ${
                    activeId === chat.id 
                      ? 'bg-slate-800 border-slate-700 text-blue-400' 
                      : 'border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[11px] font-bold truncate leading-none">{chat.title}</span>
                  </div>
                  <X 
                    className="w-3 h-3 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity shrink-0" 
                    onClick={(e) => deleteChat(chat.id, e)}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-3 px-1 font-bold">Aide Mémoire</p>
            <div className="space-y-2">
              {frequentTopics.map((topic) => (
                <div 
                  key={topic.label}
                  className="bg-slate-800/30 border border-slate-800 p-2.5 rounded-xl cursor-default group"
                >
                  <p className="text-[11px] font-bold text-slate-300">{topic.label}</p>
                  <p className="text-[9px] text-slate-500 font-medium">{topic.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800">
           <div className="bg-slate-800/50 p-4 rounded-2xl border border-slate-700/30">
            <h4 className="text-white text-[10px] font-bold mb-1 uppercase tracking-tight">Expertise OHADA</h4>
            <p className="text-[10px] text-slate-500 leading-tight">
              Assistance basée sur les Actes Uniformes révisés et le Guide d'Application.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0" id="main_workspace">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0 shadow-sm z-10" id="header">
          <div className="flex items-center gap-2">
             <div className="lg:hidden w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
                <Scale className="w-4 h-4 text-white" />
             </div>
             <div>
               <h2 className="text-sm font-bold text-slate-800 leading-none mb-1">{activeChat.title}</h2>
               <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Prêt pour audit</span>
               </div>
             </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="flex items-center gap-2 text-xs font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full transition-colors border border-slate-200/50">
              <Scale className="w-3 h-3 text-indigo-500" />
              CONFORMITÉ AUDCIF
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat Window */}
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/20" id="chat_workspace">
            <div className="flex-1 overflow-y-auto p-4 lg:p-10 space-y-10 custom-scrollbar" id="chat_scroll">
               {activeChat.messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-6 border border-slate-100 italic">
                    <Bot className="w-8 h-8 text-blue-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-2">Bienvenue dans votre nouvel audit</h3>
                  <p className="text-sm text-slate-500 max-w-sm leading-relaxed">
                    Soumettez-moi vos interrogations comptables ou téléchargez une pièce justificative pour obtenir une analyse Experte OHADA.
                  </p>
                </div>
              )}
              
              <AnimatePresence initial={false}>
                {activeChat.messages.map((msg, i) => (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={i}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-3">
                       <div className={`flex items-center gap-2 px-2 py-0.5 rounded uppercase font-black text-[9px] tracking-widest ${
                         msg.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'
                       }`}>
                        {msg.role === 'user' ? (
                          <><User className="w-3 h-3" /> Requérant</>
                        ) : (
                          <><Bot className="w-3 h-3" /> Auditeur Expert</>
                        )}
                      </div>
                      <div className="h-[1px] flex-1 bg-slate-200/60"></div>
                    </div>
                    
                    <div className={`space-y-4 ${msg.role === 'user' ? 'pl-4' : 'pr-4'}`}>
                      {msg.attachment && (
                        <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-2xl w-fit shadow-sm">
                          <div className="bg-slate-100 p-2 rounded-lg">
                            <File className="w-4 h-4 text-slate-500" />
                          </div>
                          <div className="text-[11px]">
                            <p className="font-bold text-slate-800 uppercase truncate max-w-[150px]">{msg.attachment.name}</p>
                            <p className="text-slate-400 font-medium">Fichier d'audit</p>
                          </div>
                        </div>
                      )}
                      
                      <div className={`bg-white border shadow-sm p-6 lg:p-8 rounded-3xl ${
                        msg.role === 'user' 
                          ? 'border-slate-200/80 rounded-tr-none' 
                          : 'border-emerald-100/50 rounded-tl-none ring-1 ring-emerald-50/50'
                      }`}>
                        <div className="markdown-body text-[14px] leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {isLoading && (
                <div className="flex items-center gap-3 text-slate-400 text-[10px] font-black uppercase tracking-widest bg-white/80 w-fit px-5 py-2.5 rounded-full border border-slate-200 shadow-sm animate-pulse ml-4">
                  <Bot className="w-3.5 h-3.5 text-emerald-500" />
                  Génération du rapport d'audit...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Floating Panel */}
            <div className="p-6 shrink-0 bg-white border-t border-slate-100 shadow-[0_-10px_30px_rgba(0,0,0,0.02)]" id="footer_input">
              <div className="max-w-4xl mx-auto space-y-4">
                {attachment && (
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="flex items-center gap-3 p-2 bg-blue-50 border border-blue-100 rounded-xl w-fit"
                  >
                    <FileText className="w-4 h-4 text-blue-500" />
                    <span className="text-xs font-bold text-blue-700 truncate max-w-[200px]">{attachment.name}</span>
                    <button onClick={() => setAttachment(null)} className="p-1 hover:bg-blue-100 rounded-full text-blue-400">
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                )}
                
                <form 
                  onSubmit={handleSubmit}
                  className="flex gap-4 items-end"
                >
                  <div className="flex-1 relative flex items-center bg-slate-50 border border-slate-200 rounded-3xl focus-within:ring-4 focus-within:ring-blue-500/5 focus-within:bg-white transition-all shadow-sm">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={`p-3.5 ml-1 transition-colors rounded-full ${attachment ? 'text-blue-500' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} accept="image/*" />
                    
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Comment comptabiliser..."
                      className="w-full py-4 px-2 bg-transparent resize-none outline-none text-[15px] font-medium text-slate-800 placeholder:text-slate-400 max-h-40 min-h-[58px]"
                      rows={1}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                    />
                    <button 
                      type="button"
                      onClick={() => setInput(input + '| Compte | Libellé | Débit | Crédit |\n|---|---|---|---|\n| | | | |')}
                      className="p-3.5 text-slate-300 hover:text-slate-500 transition-colors hidden md:block"
                      title="Nouveau tableau"
                    >
                      <TableIcon className="w-5 h-5" />
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={(!input.trim() && !attachment) || isLoading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-xl shadow-blue-600/20 transition-all shrink-0 active:scale-90 group"
                  >
                    <Send className="w-6 h-6 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </button>
                </form>
              </div>
            </div>
          </div>

          {/* Legal Reference Panel */}
          <aside className="hidden xl:flex w-80 bg-white border-l border-slate-200 flex-col p-8 space-y-8" id="legal_panel">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Références de Loi</h3>
              <span className="text-[9px] text-blue-500 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100 uppercase">SYSCOHADA</span>
            </div>
            
            <div className="flex-1 space-y-6 overflow-y-auto pr-1 custom-scrollbar">
              <div className="p-5 rounded-3xl bg-blue-50/50 border border-blue-100 group hover:bg-blue-50 transition-all">
                <p className="text-[10px] font-black text-blue-800 mb-2 uppercase tracking-tight">AUDCIF - Article 45</p>
                <p className="text-[12px] text-blue-900/80 leading-relaxed font-medium italic">
                  "L'amortissement est la répartition systématique du montant amortissable d'un actif sur sa durée d'utilité."
                </p>
              </div>

              <div className="p-5 rounded-3xl bg-slate-50 border border-slate-200 shadow-sm">
                <p className="text-[10px] font-black text-slate-700 mb-2 uppercase tracking-tight">AUDCIF - Article 48</p>
                <p className="text-[12px] text-slate-600 leading-relaxed font-medium italic">
                  "Le plan d'amortissement doit être établi lors de l'entrée du bien dans le patrimoine. La valeur résiduelle est à déduire."
                </p>
              </div>

              <div className="p-5 rounded-3xl bg-slate-50 border border-slate-200 shadow-sm">
                <p className="text-[10px] font-black text-slate-700 mb-4 uppercase tracking-tight tracking-[0.1em]">Nomenclature Clé</p>
                <div className="space-y-3">
                  {[
                    { c: "245", l: "Matériel de transport" },
                    { c: "2845", l: "Amort. Mat. Transport" },
                    { c: "681", l: "Dotations d'exploitation" },
                    { c: "791", l: "Reprises d'exploitation" }
                  ].map(acc => (
                    <div key={acc.c} className="flex flex-col gap-1 group">
                      <span className="text-[11px] font-mono font-black text-slate-800 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm w-fit group-hover:border-blue-400 group-hover:text-blue-600 transition-all">{acc.c}</span>
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter truncate leading-none">{acc.l}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-auto pt-6 opacity-60">
              <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent w-full mb-6"></div>
              <p className="text-[10px] text-slate-400 text-center font-bold leading-relaxed italic px-2">
                RECONNU PAR L'OADA - SYSTÈME COMPTABLE RÉVISÉ 2017
              </p>
            </div>
          </aside>
        </div>
      </main>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
