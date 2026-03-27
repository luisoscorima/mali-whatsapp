import React, { useState, useEffect, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Send, 
  Users, 
  BarChart3, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  MessageSquare,
  Settings,
  LogOut,
  LogIn,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Firebase imports
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  orderBy,
  Timestamp
} from 'firebase/firestore';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  createdAt: any;
  totalMessages: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  templateName: string;
  authorUid: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  // Form state
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('promo_primavera');

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listener for Campaigns
  useEffect(() => {
    if (!user) {
      setCampaigns([]);
      return;
    }

    const q = query(
      collection(db, 'campaigns'),
      where('authorUid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const campaignData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Campaign[];
      setCampaigns(campaignData);
    }, (error) => {
      console.error("Error fetching campaigns:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newCampaignName) return;

    try {
      await addDoc(collection(db, 'campaigns'), {
        name: newCampaignName,
        status: 'draft',
        createdAt: serverTimestamp(),
        totalMessages: 0,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        templateName: newTemplateName,
        authorUid: user.uid
      });
      
      setNewCampaignName('');
      setIsCreateModalOpen(false);
    } catch (error) {
      console.error("Error creating campaign:", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin opacity-20" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white border border-[#141414] p-12 text-center shadow-2xl"
        >
          <div className="mb-8">
            <div className="w-16 h-16 bg-[#141414] text-[#E4E3E0] flex items-center justify-center mx-auto mb-4">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tighter">MALI WHATSAPP</h1>
            <p className="text-sm opacity-50 mt-2">Inicia sesión para gestionar tus campañas masivas.</p>
          </div>
          
          <button 
            onClick={handleLogin}
            className="w-full bg-[#141414] text-[#E4E3E0] py-4 flex items-center justify-center gap-3 font-medium hover:bg-[#333] transition-colors"
          >
            <LogIn className="w-5 h-5" />
            Continuar con Google
          </button>
          
          <p className="text-[10px] uppercase tracking-widest mt-8 opacity-30 font-mono">Internal MVP v1.0</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 bottom-0 w-64 border-r border-[#141414] bg-[#E4E3E0] z-20 hidden md:flex flex-col">
        <div className="p-6 border-b border-[#141414]">
          <h1 className="text-xl font-bold tracking-tighter flex items-center gap-2">
            <MessageSquare className="w-6 h-6" />
            MALI WHATSAPP
          </h1>
          <p className="text-[10px] uppercase tracking-widest mt-1 opacity-50 font-mono">Internal MVP v1.0</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <NavItem 
            icon={<LayoutDashboard className="w-4 h-4" />} 
            label="Dashboard" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <NavItem 
            icon={<Send className="w-4 h-4" />} 
            label="Campañas" 
            active={activeTab === 'campaigns'} 
            onClick={() => setActiveTab('campaigns')} 
          />
          <NavItem 
            icon={<Users className="w-4 h-4" />} 
            label="Contactos" 
            active={activeTab === 'contacts'} 
            onClick={() => setActiveTab('contacts')} 
          />
          <NavItem 
            icon={<BarChart3 className="w-4 h-4" />} 
            label="Reportes" 
            active={activeTab === 'reports'} 
            onClick={() => setActiveTab('reports')} 
          />
        </nav>

        <div className="p-4 border-t border-[#141414] space-y-4">
          <div className="flex items-center gap-3 px-4 py-2">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-[#141414]" />
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">{user.displayName}</p>
              <p className="text-[10px] opacity-50 truncate">{user.email}</p>
            </div>
          </div>
          <NavItem 
            icon={<LogOut className="w-4 h-4" />} 
            label="Cerrar Sesión" 
            onClick={handleLogout} 
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="md:ml-64 min-h-screen">
        {/* Header */}
        <header className="h-16 border-b border-[#141414] flex items-center justify-between px-8 sticky top-0 bg-[#E4E3E0]/80 backdrop-blur-sm z-10">
          <div className="flex items-center gap-4">
            <h2 className="font-serif italic text-lg capitalize">{activeTab}</h2>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-[#141414] text-[#E4E3E0] px-4 py-2 rounded-none flex items-center gap-2 text-sm font-medium hover:bg-[#333] transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nueva Campaña
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-[#141414] border border-[#141414] mb-8">
            <StatCard 
              label="Total Enviados" 
              value={campaigns.reduce((acc, c) => acc + c.sentCount, 0).toLocaleString()} 
              subValue={`En ${campaigns.length} campañas`} 
            />
            <StatCard 
              label="Tasa de Entrega" 
              value={campaigns.length ? `${Math.round((campaigns.reduce((acc, c) => acc + c.deliveredCount, 0) / (campaigns.reduce((acc, c) => acc + c.sentCount, 0) || 1)) * 100)}%` : '0%'} 
              subValue={`${campaigns.reduce((acc, c) => acc + c.deliveredCount, 0)} mensajes`} 
            />
            <StatCard 
              label="Tasa de Lectura" 
              value={campaigns.length ? `${Math.round((campaigns.reduce((acc, c) => acc + c.readCount, 0) / (campaigns.reduce((acc, c) => acc + c.sentCount, 0) || 1)) * 100)}%` : '0%'} 
              subValue={`${campaigns.reduce((acc, c) => acc + c.readCount, 0)} mensajes`} 
            />
            <StatCard 
              label="Tasa de Error" 
              value={campaigns.length ? `${Math.round((campaigns.reduce((acc, c) => acc + c.failedCount, 0) / (campaigns.reduce((acc, c) => acc + c.sentCount, 0) || 1)) * 100)}%` : '0%'} 
              subValue={`${campaigns.reduce((acc, c) => acc + c.failedCount, 0)} errores`} 
            />
          </div>

          {/* Campaigns List */}
          <div className="border border-[#141414] bg-white">
            <div className="p-4 border-b border-[#141414] flex items-center justify-between bg-[#f5f5f5]">
              <h3 className="font-serif italic text-sm">Campañas Recientes</h3>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                  <input 
                    type="text" 
                    placeholder="Buscar..." 
                    className="pl-8 pr-4 py-1.5 text-xs border border-[#141414] bg-transparent focus:outline-none w-48"
                  />
                </div>
                <button className="p-1.5 border border-[#141414] hover:bg-white transition-colors">
                  <Filter className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#141414] bg-[#f9f9f9]">
                    <th className="p-4 text-[10px] uppercase tracking-widest opacity-50 font-mono">Nombre</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest opacity-50 font-mono">Estado</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest opacity-50 font-mono">Progreso</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest opacity-50 font-mono">Lectura</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest opacity-50 font-mono">Fecha</th>
                    <th className="p-4 text-[10px] uppercase tracking-widest opacity-50 font-mono text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-12 text-center opacity-30 italic text-sm font-serif">
                        No hay campañas creadas todavía.
                      </td>
                    </tr>
                  ) : (
                    campaigns.map((campaign) => (
                      <tr 
                        key={campaign.id} 
                        className="border-b border-[#141414] hover:bg-[#f5f5f5] transition-colors group cursor-pointer"
                      >
                        <td className="p-4">
                          <div className="font-medium text-sm">{campaign.name}</div>
                          <div className="text-[10px] font-mono opacity-50">{campaign.templateName}</div>
                        </td>
                        <td className="p-4">
                          <StatusBadge status={campaign.status} />
                        </td>
                        <td className="p-4">
                          <div className="w-full max-w-[120px]">
                            <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                              <span>{Math.round((campaign.sentCount / (campaign.totalMessages || 1)) * 100)}%</span>
                              <span className="opacity-50">{campaign.sentCount}/{campaign.totalMessages}</span>
                            </div>
                            <div className="h-1 bg-[#E4E3E0] w-full">
                              <div 
                                className="h-full bg-[#141414]" 
                                style={{ width: `${(campaign.sentCount / (campaign.totalMessages || 1)) * 100}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-sm font-mono">
                            {campaign.totalMessages > 0 
                              ? `${Math.round((campaign.readCount / campaign.totalMessages) * 100)}%` 
                              : '0%'}
                          </div>
                        </td>
                        <td className="p-4 text-xs opacity-60">
                          {campaign.createdAt instanceof Timestamp 
                            ? campaign.createdAt.toDate().toLocaleDateString() 
                            : 'Pendiente'}
                        </td>
                        <td className="p-4 text-right">
                          <button className="p-1 hover:bg-[#141414] hover:text-white transition-colors">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Create Campaign Modal */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCreateModalOpen(false)}
              className="absolute inset-0 bg-[#141414]/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[#E4E3E0] border border-[#141414] shadow-2xl"
            >
              <div className="p-6 border-b border-[#141414] flex items-center justify-between">
                <h3 className="font-serif italic text-xl">Nueva Campaña</h3>
                <button onClick={() => setIsCreateModalOpen(false)} className="opacity-50 hover:opacity-100 transition-opacity">
                  <Plus className="w-6 h-6 rotate-45" />
                </button>
              </div>
              
              <form onSubmit={handleCreateCampaign} className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Nombre de la Campaña</label>
                  <input 
                    type="text" 
                    required
                    value={newCampaignName}
                    onChange={(e) => setNewCampaignName(e.target.value)}
                    placeholder="Ej. Promo Cyber Monday"
                    className="w-full bg-white border border-[#141414] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Plantilla de WhatsApp</label>
                  <select 
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    className="w-full bg-white border border-[#141414] p-3 text-sm focus:outline-none appearance-none"
                  >
                    <option value="promo_primavera">promo_primavera</option>
                    <option value="recordatorio_pago">recordatorio_pago</option>
                    <option value="encuesta_v1">encuesta_v1</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-mono opacity-50">Lista de Contactos (CSV)</label>
                  <div className="border border-dashed border-[#141414] p-8 text-center bg-white/50 hover:bg-white transition-colors cursor-pointer group">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-20 group-hover:opacity-100 transition-opacity" />
                    <p className="text-xs">Arrastra tu archivo CSV o haz clic para subir</p>
                    <p className="text-[10px] opacity-40 mt-1">Formato: telefono, nombre, variable1...</p>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="submit"
                    className="flex-1 bg-[#141414] text-[#E4E3E0] py-3 text-sm font-medium hover:bg-[#333] transition-colors"
                  >
                    Crear Campaña
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="flex-1 border border-[#141414] py-3 text-sm font-medium hover:bg-white transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 group",
        active 
          ? "bg-[#141414] text-[#E4E3E0]" 
          : "hover:bg-[#141414]/5 text-[#141414]/70 hover:text-[#141414]"
      )}
    >
      <span className={cn("transition-transform duration-200", active ? "scale-110" : "group-hover:scale-110")}>
        {icon}
      </span>
      <span className="font-medium">{label}</span>
      {active && <ChevronRight className="w-3 h-3 ml-auto opacity-50" />}
    </button>
  );
}

function StatCard({ label, value, subValue }: { label: string, value: string, subValue: string }) {
  return (
    <div className="bg-white p-6 flex flex-col justify-between group hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors duration-300">
      <p className="text-[10px] uppercase tracking-widest font-mono opacity-50 group-hover:opacity-70">{label}</p>
      <div className="mt-4">
        <h4 className="text-3xl font-bold tracking-tighter">{value}</h4>
        <p className="text-[10px] mt-1 opacity-40 group-hover:opacity-60 font-mono">{subValue}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Campaign['status'] }) {
  const styles = {
    draft: "bg-gray-100 text-gray-600 border-gray-200",
    sending: "bg-blue-50 text-blue-600 border-blue-200 animate-pulse",
    completed: "bg-green-50 text-green-600 border-green-200",
    failed: "bg-red-50 text-red-600 border-red-200"
  };

  const icons = {
    draft: <Clock className="w-3 h-3" />,
    sending: <Send className="w-3 h-3" />,
    completed: <CheckCircle2 className="w-3 h-3" />,
    failed: <AlertCircle className="w-3 h-3" />
  };

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-none border text-[10px] font-mono uppercase tracking-wider",
      styles[status]
    )}>
      {icons[status]}
      {status}
    </div>
  );
}
