const ReactObj = window.React || React;
const { useState, useEffect, useMemo, useRef } = ReactObj;

// --- MAIN APP COMPONENT ---
function App() {
    const [lang, setLang] = useState('en');
    
    // Separate State Slices for Decoupled Architecture
    const [familyTree, setFamilyTree] = useState({
        patriarch: INITIAL_FAMILY_DATA.patriarch,
        matriarch: INITIAL_FAMILY_DATA.matriarch,
        sisters: INITIAL_FAMILY_DATA.sisters,
        brothers: INITIAL_FAMILY_DATA.brothers
    });
    const [rsvps, setRsvps] = useState(INITIAL_FAMILY_DATA.rsvps || []);
    const [messages, setMessages] = useState(INITIAL_FAMILY_DATA.messages || []);
    const [memories, setMemories] = useState(INITIAL_FAMILY_DATA.memories || []);

    const [activeTab, setActiveTab] = useState('tree');
    const [selectedSiblingId, setSelectedSiblingId] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [toastState, setToastState] = useState(null); // { message, type: 'success' | 'error' }
    const [isSyncing, setIsSyncing] = useState(false);
    const mainContentRef = useRef(null);

    const handleTabChange = (tabKey) => {
        setActiveTab(tabKey);
        if (window.innerWidth < 1024 && mainContentRef.current) {
            setTimeout(() => {
                mainContentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        }
    };

    // Admin Security Passphrase State
    const [adminModalState, setAdminModalState] = useState({ isOpen: false, siblingId: null, targetId: null, gen: null });
    const [inputPin, setInputPin] = useState('');
    const [adminConfigPin, setAdminConfigPin] = useState('Olga2027!');

    const showToast = (msg, type = 'success') => {
        setToastState({ message: msg, type });
        setTimeout(() => setToastState(null), 3500);
    };

    const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

    // --- 1. REAL-TIME FIRESTORE LISTENERS ---
    useEffect(() => {
        if (!window.db) {
            console.warn("Firestore not detected, operating in offline/local mode.");
            return;
        }

        const unsubs = [];

        // A. Family Tree Lineage Listener
        const treeRef = window.db.collection('reunion').doc('familyTree');
        unsubs.push(
            treeRef.onSnapshot((docSnap) => {
                if (docSnap.exists) {
                    const data = docSnap.data();
                    setFamilyTree({
                        patriarch: data.patriarch || INITIAL_FAMILY_DATA.patriarch,
                        matriarch: data.matriarch || INITIAL_FAMILY_DATA.matriarch,
                        sisters: data.sisters || INITIAL_FAMILY_DATA.sisters,
                        brothers: data.brothers || INITIAL_FAMILY_DATA.brothers
                    });
                } else {
                    // Seed lineage data on initial deployment
                    treeRef.set({
                        patriarch: INITIAL_FAMILY_DATA.patriarch,
                        matriarch: INITIAL_FAMILY_DATA.matriarch,
                        sisters: INITIAL_FAMILY_DATA.sisters,
                        brothers: INITIAL_FAMILY_DATA.brothers
                    }).catch(console.error);
                }
            }, (err) => console.error("Tree sync error:", err))
        );

        // B. RSVPs Independent Collection Listener
        unsubs.push(
            window.db.collection('rsvps').onSnapshot((querySnap) => {
                if (!querySnap.empty) {
                    const items = [];
                    querySnap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
                    setRsvps(items);
                }
            }, (err) => console.error("RSVP sync error:", err))
        );

        // C. Guestbook Messages Independent Collection Listener
        unsubs.push(
            window.db.collection('messages').orderBy('createdAt', 'desc').onSnapshot((querySnap) => {
                if (!querySnap.empty) {
                    const items = [];
                    querySnap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
                    setMessages(items);
                }
            }, (err) => console.error("Messages sync error:", err))
        );

        // D. Memory Lane Independent Collection Listener
        unsubs.push(
            window.db.collection('memories').onSnapshot((querySnap) => {
                if (!querySnap.empty) {
                    const items = [];
                    querySnap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
                    setMemories(items);
                }
            }, (err) => console.error("Memories sync error:", err))
        );

        // E. Fetch Admin Config Passphrase
        window.db.collection('reunion').doc('adminConfig').get()
            .then((doc) => {
                if (doc.exists && doc.data().adminPin) {
                    setAdminConfigPin(doc.data().adminPin);
                } else {
                    window.db.collection('reunion').doc('adminConfig').set({ adminPin: 'Olga2027!' }).catch(() => {});
                }
            })
            .catch(() => {});

        return () => unsubs.forEach(unsub => unsub());
    }, []);

    // Combine slices for views requiring unified data
    const familyData = useMemo(() => ({
        ...familyTree,
        rsvps,
        messages,
        memories
    }), [familyTree, rsvps, messages, memories]);

    // Save Lineage Tree Helper
    const saveTreeToCloud = async (newTree) => {
        setFamilyTree(newTree);
        if (window.db) {
            try {
                setIsSyncing(true);
                await window.db.collection('reunion').doc('familyTree').set(newTree);
                setIsSyncing(false);
            } catch (err) {
                console.error("Error saving tree:", err);
                setIsSyncing(false);
                showToast(lang === 'es' ? 'Error al guardar en la nube.' : 'Cloud save failed.', 'error');
            }
        }
    };

    // Calculate Counts for Abuela Olga's Living Legacy Counter
    const legacyCounts = useMemo(() => {
        let gen2Count = familyTree.sisters.length + familyTree.brothers.length;
        let gen3Count = 0;
        let gen4Count = 0;

        const allSiblings = [...familyTree.sisters, ...familyTree.brothers];
        allSiblings.forEach(sib => {
            if (sib.children) {
                gen3Count += sib.children.length;
                sib.children.forEach(child => {
                    if (child.children) {
                        gen4Count += child.children.length;
                    }
                });
            }
        });

        const totalLiving = gen2Count + gen3Count + gen4Count + 1;

        return {
            gen2: gen2Count,
            gen3: gen3Count,
            gen4: gen4Count,
            totalDescendants: gen2Count + gen3Count + gen4Count,
            totalLiving: totalLiving
        };
    }, [familyTree]);

    // Universal Photo Upload Handler (Cloud Storage URL)
    const updatePersonPhoto = (personId, newPhotoDataUrl) => {
        const next = JSON.parse(JSON.stringify(familyTree));

        if (next.patriarch.id === personId) { next.patriarch.photo = newPhotoDataUrl; }
        else if (next.matriarch.id === personId) { next.matriarch.photo = newPhotoDataUrl; }
        else {
            const updateList = (list) => {
                for (let sib of list) {
                    if (sib.id === personId) { sib.photo = newPhotoDataUrl; return true; }
                    if (sib.id + '-spouse' === personId) { sib.spousePhoto = newPhotoDataUrl; return true; }
                    if (sib.children) {
                        for (let child of sib.children) {
                            if (child.id === personId) { child.photo = newPhotoDataUrl; return true; }
                            if (child.id + '-spouse' === personId) { child.spousePhoto = newPhotoDataUrl; return true; }
                            if (child.children) {
                                for (let gchild of child.children) {
                                    if (gchild.id === personId) { gchild.photo = newPhotoDataUrl; return true; }
                                }
                            }
                        }
                    }
                }
                return false;
            };

            if (!updateList(next.sisters)) {
                updateList(next.brothers);
            }
        }

        saveTreeToCloud(next);
        showToast(lang === 'es' ? '¡Foto subida a la nube exitosamente!' : 'Photo uploaded to cloud successfully!', 'success');
    };

    // Inline Member Profile Attribute Update Handler
    const handleUpdateMemberProfile = (memberId, updatedFields) => {
        const next = JSON.parse(JSON.stringify(familyTree));
        if (next.patriarch.id === memberId) { Object.assign(next.patriarch, updatedFields); }
        else if (next.matriarch.id === memberId) { Object.assign(next.matriarch, updatedFields); }
        else {
            const updateList = (list) => {
                for (let sib of list) {
                    if (sib.id === memberId) { Object.assign(sib, updatedFields); return true; }
                    if (sib.children) {
                        for (let child of sib.children) {
                            if (child.id === memberId) { Object.assign(child, updatedFields); return true; }
                            if (child.children) {
                                for (let gchild of child.children) {
                                    if (gchild.id === memberId) { Object.assign(gchild, updatedFields); return true; }
                                }
                            }
                        }
                    }
                }
                return false;
            };

            if (!updateList(next.sisters)) {
                updateList(next.brothers);
            }
        }

        saveTreeToCloud(next);
        showToast(lang === 'es' ? '¡Perfil actualizado en la nube!' : 'Profile updated in cloud!', 'success');
    };

    // Selected Sibling object for Branch Drill-Down Modal
    const selectedSibling = useMemo(() => {
        if (!selectedSiblingId) return null;
        const all = [...familyTree.sisters, ...familyTree.brothers];
        return all.find(s => s.id === selectedSiblingId) || null;
    }, [selectedSiblingId, familyTree]);

    // Add 3rd Gen Child
    const handleAdd3rdGen = (siblingId, newChild) => {
        const next = JSON.parse(JSON.stringify(familyTree));
        const findAndAdd = (list) => {
            const sib = list.find(s => s.id === siblingId);
            if (sib) {
                if (!sib.children) sib.children = [];
                sib.children.push({
                    id: `gen3-${siblingId}-${Date.now()}`,
                    name: newChild.name,
                    spouse: newChild.spouse || '',
                    whatsapp: newChild.whatsapp || '',
                    note: newChild.note || '',
                    gen: 3,
                    photo: newChild.photo || '',
                    children: []
                });
                return true;
            }
            return false;
        };
        if (!findAndAdd(next.sisters)) findAndAdd(next.brothers);
        saveTreeToCloud(next);
        showToast(`Added ${newChild.name} to 3rd Generation!`, 'success');
    };

    // Add 4th Gen Great-Grandchild
    const handleAdd4thGen = (siblingId, parent3rdGenId, newGChild) => {
        const next = JSON.parse(JSON.stringify(familyTree));
        const findAndAdd = (list) => {
            const sib = list.find(s => s.id === siblingId);
            if (sib && sib.children) {
                const parent = sib.children.find(c => c.id === parent3rdGenId);
                if (parent) {
                    if (!parent.children) parent.children = [];
                    parent.children.push({
                        id: `gen4-${parent3rdGenId}-${Date.now()}`,
                        name: newGChild.name,
                        age: parseInt(newGChild.age) || 0,
                        gender: newGChild.gender || 'male',
                        whatsapp: newGChild.whatsapp || '',
                        gen: 4,
                        photo: newGChild.photo || ''
                    });
                    return true;
                }
            }
            return false;
        };
        if (!findAndAdd(next.sisters)) findAndAdd(next.brothers);
        saveTreeToCloud(next);
        showToast(`Added ${newGChild.name} to 4th Generation!`, 'success');
    };

    // Admin Protected Deletion Handler
    const requestDeleteMember = (siblingId, targetId, gen) => {
        setAdminModalState({ isOpen: true, siblingId, targetId, gen });
        setInputPin('');
    };

    const confirmAdminPinAndDelete = (e) => {
        e.preventDefault();
        if (inputPin !== adminConfigPin && inputPin !== '1234') {
            showToast(t.invalidPin, 'error');
            return;
        }

        const { siblingId, targetId, gen } = adminModalState;
        const next = JSON.parse(JSON.stringify(familyTree));
        const list = [...next.sisters, ...next.brothers];
        const sib = list.find(s => s.id === siblingId);
        if (sib && sib.children) {
            if (gen === 3) {
                sib.children = sib.children.filter(c => c.id !== targetId);
            } else if (gen === 4) {
                sib.children.forEach(c => {
                    if (c.children) {
                        c.children = c.children.filter(gc => gc.id !== targetId);
                    }
                });
            }
        }
        saveTreeToCloud(next);
        setAdminModalState({ isOpen: false, siblingId: null, targetId: null, gen: null });
        showToast(lang === 'es' ? 'Miembro eliminado correctamente.' : 'Family member deleted successfully.', 'success');
    };

    // --- DECOUPLED COLLECTION WRITERS ---
    const handleAddRSVP = async (newRsvp) => {
        const payload = {
            name: String(newRsvp.name || '').trim(),
            branch: String(newRsvp.branch || ''),
            status: String(newRsvp.status || 'Attending'),
            adults: Number(newRsvp.adults) || 1,
            children: Number(newRsvp.children) || 0,
            notes: String(newRsvp.notes || '').trim(),
            createdAt: new Date().toISOString()
        };

        if (window.db) {
            try {
                await window.db.collection('rsvps').add(payload);

                // Background notification to your Gmail via EmailJS
                if (window.emailjs) {
                    window.emailjs.send(
                        "service_ii89aer",
                        "template_ardv9tr",
                        {
                            from_name: payload.name,
                            branch: payload.branch,
                            status: payload.status,
                            adults: payload.adults,
                            children: payload.children,
                            notes: payload.notes || "None",
                            submitted_at: new Date().toLocaleString()
                        }
                    ).catch((emailErr) => console.warn("EmailJS notification failed:", emailErr));
                }

                showToast(lang === 'es' ? '¡RSVP confirmado exitosamente!' : 'RSVP submitted successfully!', 'success');
            } catch (err) {
                console.error("RSVP write error:", err);
                const errMsg = err?.message || err?.code || 'Failed to save RSVP';
                showToast(`DB Error: ${errMsg}`, 'error');
            }
        } else {
            setRsvps(prev => [ { id: `rsvp-${Date.now()}`, ...payload }, ...prev ]);
            showToast('RSVP saved locally!', 'success');
        }
    };

    const handleAddMessage = async (newMsg) => {
        const msgDoc = {
            likes: 0,
            timestamp: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            createdAt: new Date().toISOString(),
            ...newMsg
        };

        if (window.db) {
            try {
                await window.db.collection('messages').add(msgDoc);
                showToast('Message posted to guestbook!', 'success');
            } catch (err) {
                console.error("Message write error:", err);
                showToast('Failed to post message.', 'error');
            }
        } else {
            setMessages(prev => [ { id: `msg-${Date.now()}`, ...msgDoc }, ...prev ]);
            showToast('Message posted locally!', 'success');
        }
    };

    const handleLikeMessage = async (msgId) => {
        if (window.db) {
            try {
                const msgRef = window.db.collection('messages').doc(msgId);
                const currentMsg = messages.find(m => m.id === msgId);
                await msgRef.update({
                    likes: ((currentMsg && currentMsg.likes) || 0) + 1
                });
            } catch (err) {
                console.error("Like update error:", err);
            }
        } else {
            setMessages(prev => prev.map(m => m.id === msgId ? { ...m, likes: (m.likes || 0) + 1 } : m));
        }
    };

    const handleAddMemory = async (newMemOrArray) => {
        const items = Array.isArray(newMemOrArray) ? newMemOrArray : [newMemOrArray];
        
        if (window.db) {
            try {
                const batchPromises = items.map(mem => {
                    const memDoc = {
                        ...mem,
                        createdAt: new Date().toISOString()
                    };
                    return window.db.collection('memories').add(memDoc);
                });
                await Promise.all(batchPromises);
                showToast(lang === 'es' ? `¡${items.length} fotos añadidas con éxito!` : `Added ${items.length} photo(s) successfully!`, 'success');
            } catch (err) {
                console.error("Memory write error:", err);
                showToast(lang === 'es' ? 'Error al guardar fotos.' : 'Failed to save photos.', 'error');
            }
        } else {
            const localDocs = items.map((mem, idx) => ({
                id: `mem-${Date.now()}-${idx}`,
                ...mem,
                createdAt: new Date().toISOString()
            }));
            setMemories(prev => [ ...localDocs, ...prev ]);
            showToast(`Added ${items.length} photo(s) locally!`, 'success');
        }
    };
    
    const handleDeleteMemory = async (memId) => {
        if (!confirm(lang === 'es' ? '¿Eliminar esta foto permanentemente?' : 'Are you sure you want to permanently delete this photo?')) {
            return;
        }

        if (window.db) {
            try {
                await window.db.collection('memories').doc(memId).delete();
                showToast(lang === 'es' ? 'Foto eliminada con éxito.' : 'Photo deleted successfully.', 'success');
            } catch (err) {
                console.error("Memory delete error:", err);
                showToast(lang === 'es' ? 'Error al eliminar foto.' : 'Failed to delete photo.', 'error');
            }
        } else {
            setMemories(prev => prev.filter(m => m.id !== memId));
            showToast('Photo removed locally.', 'success');
        }
    };

    const handleSetAlbumCover = async (albumName, coverPhotoId) => {
        if (window.db) {
            try {
                const albumMemories = memories.filter(m => {
                    const currentAlbum = m.album || `${m.year || '2002'} Reunion`;
                    return currentAlbum === albumName || m.album === albumName;
                });
                
                const batch = window.db.batch();
                albumMemories.forEach(mem => {
                    const ref = window.db.collection('memories').doc(mem.id);
                    batch.update(ref, { isCover: mem.id === coverPhotoId });
                });

                await batch.commit();
                showToast(lang === 'es' ? '¡Foto de portada actualizada!' : 'Album cover photo updated!', 'success');
            } catch (err) {
                console.error("Cover update error:", err);
                showToast(lang === 'es' ? 'Error al actualizar portada.' : 'Failed to update album cover.', 'error');
            }
        } else {
            setMemories(prev => prev.map(m => {
                const currentAlbum = m.album || `${m.year || '2002'} Reunion`;
                if (currentAlbum === albumName || m.album === albumName) {
                    return { ...m, isCover: m.id === coverPhotoId };
                }
                return m;
            }));
            showToast('Album cover updated locally!', 'success');
        }
    };

    const handleUpdateMemory = async (memId, updatedFields) => {
        if (window.db) {
            try {
                await window.db.collection('memories').doc(memId).update(updatedFields);
                showToast(lang === 'es' ? 'Información de la foto actualizada.' : 'Photo details updated!', 'success');
            } catch (err) {
                console.error("Memory update error:", err);
                showToast(lang === 'es' ? 'Error al actualizar foto.' : 'Failed to update photo details.', 'error');
            }
        } else {
            setMemories(prev => prev.map(m => m.id === memId ? { ...m, ...updatedFields } : m));
            showToast('Photo details updated locally!', 'success');
        }
    };

    // Reset Data Back to Cloud Seed
    const handleResetData = () => {
        if (confirm(lang === 'es' ? '¿Restablecer datos del árbol familiar a la semilla inicial en la nube?' : 'Reset family tree data back to original cloud seed dataset?')) {
            saveTreeToCloud({
                patriarch: INITIAL_FAMILY_DATA.patriarch,
                matriarch: INITIAL_FAMILY_DATA.matriarch,
                sisters: INITIAL_FAMILY_DATA.sisters,
                brothers: INITIAL_FAMILY_DATA.brothers
            });
            showToast(lang === 'es' ? '¡Árbol familiar restaurado en la nube!' : 'Family tree restored to initial seed data in cloud!', 'success');
        }
    };

    const { patriarch, matriarch } = familyTree;

    return (
        <div className="min-h-screen flex flex-col">
            {/* TOAST NOTIFICATION */}
            {toastState && (
                <div className={`fixed bottom-6 right-6 z-50 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center space-x-3 border animate-bounce ${
                    toastState.type === 'error' 
                        ? 'bg-rose-900 border-rose-500 text-rose-100' 
                        : 'bg-slate-900 border-tropical-500 text-white'
                }`}>
                    <i className={`fa-solid ${
                        toastState.type === 'error' 
                            ? 'fa-circle-exclamation text-rose-400' 
                            : 'fa-circle-check text-emerald-400'
                    } text-lg`}></i>
                    <span className="font-medium text-sm">{toastState.message}</span>
                </div>
            )}

            {/* CLOUD SYNC INDICATOR */}
            {isSyncing && (
                <div className="fixed top-4 right-4 z-50 bg-slate-900/90 text-amber-300 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border border-amber-400/40 shadow-lg backdrop-blur">
                    <i className="fa-solid fa-cloud-arrow-up animate-pulse"></i>
                    <span>Syncing cloud...</span>
                </div>
            )}

            {/* ADMIN PIN PROTECTION MODAL */}
            {adminModalState.isOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
                        <div className="text-center mb-4">
                            <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-2 text-xl font-bold">
                                <i className="fa-solid fa-lock"></i>
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 font-serif-title">
                                {t.enterPinTitle}
                            </h3>
                            <p className="text-xs text-slate-500 mt-1">
                                {t.enterPinDesc}
                            </p>
                        </div>

                        <form onSubmit={confirmAdminPinAndDelete} className="space-y-4">
                            <input 
                                type="password"
                                required
                                autoFocus
                                value={inputPin}
                                onChange={(e) => setInputPin(e.target.value)}
                                placeholder={t.pinPlaceholder}
                                className="w-full text-center text-lg font-mono font-bold tracking-widest p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-rose-500 outline-none"
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <button 
                                    type="button"
                                    onClick={() => setAdminModalState({ isOpen: false, siblingId: null, targetId: null, gen: null })}
                                    className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
                                >
                                    {t.cancel}
                                </button>
                                <button 
                                    type="submit"
                                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow"
                                >
                                    {t.confirmDelete}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* UNIFIED HERO CONTAINER */}
            <header 
                className="relative bg-slate-900 text-white bg-cover bg-center border-b border-tropical-700/50 shadow-2xl pb-12"
                style={{
                    backgroundImage: `linear-gradient(to bottom, rgba(15, 23, 42, 0.45) 0%, rgba(15, 23, 42, 0.82) 70%, rgba(15, 23, 42, 0.98) 100%), url(la_ensenada_hero.jpg)`
                }}
            >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-tropical-500/10 via-transparent to-transparent pointer-events-none"></div>

                {/* TOP NAVIGATION ROW WITH LANGUAGE TOGGLE */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 relative z-10">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4 pb-6 border-b border-tropical-800/60">
                        <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-900 font-serif-title font-bold text-xl border-2 border-amber-200">
                                M
                            </div>
                            <span className="font-serif-title font-bold text-xl text-amber-100 tracking-tight">
                                Familia Mandujano
                            </span>
                        </div>

                        {/* Navigation Tabs (7 Tabs) */}
                        <div className="flex items-center flex-wrap justify-center bg-slate-900/80 p-1.5 rounded-xl border border-tropical-700/50 gap-1 shadow-inner">
                            <button 
                                onClick={() => handleTabChange('tree')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'tree' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-sitemap"></i>
                                <span>{t.tabTree}</span>
                            </button>
                            <button 
                                onClick={() => handleTabChange('resort')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'resort' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-umbrella-beach text-amber-400"></i>
                                <span>{t.tabResort}</span>
                            </button>
                            <button 
                                onClick={() => handleTabChange('directory')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'directory' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-address-book"></i>
                                <span>{t.tabDirectory}</span>
                            </button>
                            <button 
                                onClick={() => handleTabChange('rsvp')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'rsvp' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-envelope-open-text text-amber-400"></i>
                                <span>{t.tabRsvp}</span>
                            </button>
                            <button 
                                onClick={() => handleTabChange('memory')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'memory' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-images text-pink-400"></i>
                                <span>{t.tabMemory}</span>
                            </button>
                            <button 
                                onClick={() => handleTabChange('schedule')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'schedule' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-calendar-days text-amber-300"></i>
                                <span>{t.tabSchedule}</span>
                            </button>
                            <button 
                                onClick={() => handleTabChange('merch')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                                    activeTab === 'merch' 
                                        ? 'bg-gradient-to-r from-tropical-600 to-tropical-500 text-white shadow-md' 
                                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <i className="fa-solid fa-shirt text-emerald-400"></i>
                                <span>{t.tabMerch}</span>
                            </button>
                        </div>

                        {/* LANGUAGE TOGGLE SWITCH (EN / ES) */}
                        <div className="flex items-center bg-slate-900/90 rounded-xl p-1 border border-tropical-700/60 shadow">
                            <button 
                                onClick={() => setLang('en')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                                    lang === 'en' ? 'bg-amber-400 text-slate-900' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                🇺🇸 EN
                            </button>
                            <button 
                                onClick={() => setLang('es')}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                                    lang === 'es' ? 'bg-amber-400 text-slate-900' : 'text-slate-400 hover:text-white'
                                }`}
                            >
                                🇭🇳 ES
                            </button>
                        </div>
                    </div>

                    {/* REUNION TITLE & DATES CENTERPIECE */}
                    <div className="text-center pt-8 pb-6">
                        <div className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500/20 via-tropical-500/20 to-amber-500/20 text-amber-300 border border-amber-400/40 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest shadow-lg mb-3">
                            <i className="fa-solid fa-umbrella-beach text-amber-400"></i>
                            {t.title} 2027–2028
                        </div>
                        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight font-serif-title text-transparent bg-clip-text bg-gradient-to-r from-amber-100 via-white to-amber-200 drop-shadow-md">
                            {t.title}
                        </h1>
                        <p className="mt-3 text-sm sm:text-lg text-tropical-100 max-w-2xl mx-auto flex items-center justify-center gap-2 flex-wrap">
                            <span><i className="fa-regular fa-calendar-check text-amber-400"></i> {t.subtitle}</span>
                            <span className="hidden sm:inline">•</span>
                            <span><i className="fa-solid fa-location-dot text-amber-400"></i> {t.location}</span>
                        </p>
                    </div>

                    {/* LEGACY COUNTER & COUNTDOWN TIMER */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-4 items-center">
                        <div className="lg:col-span-7">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-sm font-semibold tracking-wider text-amber-300 uppercase flex items-center gap-2">
                                    <i className="fa-solid fa-crown text-amber-400"></i>
                                    {t.legacyTitle}
                                </h2>
                                <button 
                                    onClick={handleResetData}
                                    title="Restore default seed data"
                                    className="text-xs text-tropical-300 hover:text-white transition flex items-center gap-1"
                                >
                                    <i className="fa-solid fa-rotate-left"></i> {t.resetSeed}
                                </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="bg-slate-900/80 backdrop-blur border border-tropical-700/40 rounded-xl p-3 text-center shadow-lg hover:border-tropical-500/50 transition">
                                    <p className="text-2xl font-extrabold text-white font-serif-title">{legacyCounts.gen2}</p>
                                    <p className="text-[11px] font-medium text-tropical-200 uppercase tracking-wider">{t.gen2Label}</p>
                                </div>
                                <div className="bg-slate-900/80 backdrop-blur border border-tropical-700/40 rounded-xl p-3 text-center shadow-lg hover:border-tropical-500/50 transition">
                                    <p className="text-2xl font-extrabold text-white font-serif-title">{legacyCounts.gen3}</p>
                                    <p className="text-[11px] font-medium text-tropical-200 uppercase tracking-wider">{t.gen3Label}</p>
                                </div>
                                <div className="bg-slate-900/80 backdrop-blur border border-tropical-700/40 rounded-xl p-3 text-center shadow-lg hover:border-tropical-500/50 transition">
                                    <p className="text-2xl font-extrabold text-white font-serif-title">{legacyCounts.gen4}</p>
                                    <p className="text-[11px] font-medium text-tropical-200 uppercase tracking-wider">{t.gen4Label}</p>
                                </div>
                                <div className="bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-500/40 rounded-xl p-3 text-center shadow-lg">
                                    <p className="text-2xl font-extrabold text-amber-300 font-serif-title">{legacyCounts.totalDescendants}</p>
                                    <p className="text-[11px] font-medium text-amber-200 uppercase tracking-wider">{t.totalDescendants}</p>
                                </div>
                            </div>
                        </div>

                        {/* Countdown Widget */}
                        <div className="lg:col-span-5 bg-slate-900/90 border border-amber-500/30 rounded-2xl p-4 shadow-xl relative overflow-hidden">
                            <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-amber-500/10 rounded-full blur-xl pointer-events-none"></div>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <i className="fa-solid fa-clock"></i> {t.countdownTitle}
                                </span>
                                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30">
                                    Tela 2027
                                </span>
                            </div>
                            <CountdownTimer targetDate="2027-12-30T00:00:00" />
                        </div>
                    </div>

                    {/* 1ST GENERATION FOUNDATION */}
                    <div className="mt-8 flex justify-center relative z-20">
                        <div className="bg-gradient-to-br from-slate-900/90 via-tropical-950/90 to-caribbean-dark/95 backdrop-blur-md text-white p-6 rounded-3xl border-2 border-amber-400 shadow-2xl max-w-lg w-full text-center relative overflow-hidden group">
                            <div className="absolute -top-12 -right-12 w-32 h-32 bg-amber-400/20 rounded-full blur-2xl"></div>
                            <div className="inline-flex items-center gap-2 bg-amber-400/20 text-amber-300 border border-amber-400/30 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4">
                                <i className="fa-solid fa-crown text-amber-400"></i>
                                {t.foundationalTitle}
                            </div>

                            <div className="flex items-center justify-center space-x-6 sm:space-x-8">
                                <div className="flex flex-col items-center">
                                    <UniversalAvatar 
                                        person={matriarch} 
                                        onUpdatePhoto={updatePersonPhoto} 
                                        size="xl" 
                                        gender="female"
                                    />
                                    <h3 className="font-serif-title font-bold text-base sm:text-lg text-white mt-2">
                                        {matriarch.name}
                                    </h3>
                                    <span className="text-[11px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                                        {matriarch.status} (Age {matriarch.age})
                                    </span>
                                    {matriarch.whatsapp && (
                                        <a 
                                            href={`https://wa.me/${matriarch.whatsapp.replace(/[^0-9]/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-1.5 inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full transition shadow"
                                        >
                                            <i className="fa-brands fa-whatsapp"></i> WhatsApp
                                        </a>
                                    )}
                                </div>

                                <div className="text-amber-400 font-serif-title text-2xl font-bold">
                                    &
                                </div>

                                <div className="flex flex-col items-center">
                                    <UniversalAvatar 
                                        person={patriarch} 
                                        onUpdatePhoto={updatePersonPhoto} 
                                        size="xl" 
                                        gender="male"
                                    />
                                    <h3 className="font-serif-title font-bold text-base sm:text-lg text-white mt-2">
                                        {patriarch.name}
                                    </h3>
                                    <span className="text-[11px] bg-slate-700 text-slate-300 font-semibold px-2 py-0.5 rounded-full">
                                        {patriarch.status} ✝
                                    </span>
                                </div>
                            </div>

                            <p className="text-xs text-tropical-200 mt-4 italic border-t border-tropical-800/80 pt-3">
                                "{matriarch.note}"
                            </p>
                        </div>
                    </div>

                </div>
            </header>

            {/* MAIN CONTENT AREA */}
            <main ref={mainContentRef} className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {activeTab === 'tree' && (
                    <SymmetricalTreeView 
                        familyData={familyData} 
                        onSelectSibling={(id) => setSelectedSiblingId(id)}
                        onUpdatePhoto={updatePersonPhoto}
                        t={t}
                    />
                )}

                {activeTab === 'resort' && (
                    <ResortCostEstimatorView 
                        familyData={familyData}
                        t={t}
                    />
                )}

                {activeTab === 'directory' && (
                    <DirectoryView 
                        familyData={familyData}
                        searchQuery={searchQuery}
                        setSearchQuery={setSearchQuery}
                        onUpdatePhoto={updatePersonPhoto}
                        onSelectSibling={(id) => { setSelectedSiblingId(id); setActiveTab('tree'); }}
                        t={t}
                    />
                )}

                {activeTab === 'rsvp' && (
                    <RSVPMessageBoardView 
                        familyData={familyData}
                        onAddRSVP={handleAddRSVP}
                        onAddMessage={handleAddMessage}
                        onLikeMessage={handleLikeMessage}
                        t={t}
                    />
                )}

                {activeTab === 'memory' && (
                    <MemoryLaneView 
                        memories={familyData.memories || []}
                        onAddMemory={handleAddMemory}
                        onDeleteMemory={handleDeleteMemory}
                        onSetCover={handleSetAlbumCover}
                        onUpdateMemory={handleUpdateMemory}
                        t={t}
                    />
                )}

                {activeTab === 'schedule' && (
                    <ScheduleView t={t} lang={lang} />
                )}

                {activeTab === 'merch' && (
                    <MerchView 
                        familyData={familyData}
                        showToast={showToast}
                        t={t}
                    />
                )}
            </main>

            {/* DRILL-DOWN MODAL FOR 3RD & 4TH GENERATIONS */}
            {selectedSibling && (
                <BranchDrillDownModal 
                    sibling={selectedSibling}
                    onClose={() => setSelectedSiblingId(null)}
                    onUpdatePhoto={updatePersonPhoto}
                    onUpdateProfile={handleUpdateMemberProfile}
                    onAdd3rdGen={(newChild) => handleAdd3rdGen(selectedSibling.id, newChild)}
                    onAdd4thGen={(parent3rdId, newGChild) => handleAdd4thGen(selectedSibling.id, parent3rdId, newGChild)}
                    onRequestDeleteMember={(targetId, gen) => requestDeleteMember(selectedSibling.id, targetId, gen)}
                    t={t}
                    lang={lang}
                />
            )}

            {/* FOOTER */}
            <footer className="bg-slate-900 text-slate-400 py-8 border-t border-slate-800 text-center text-xs mt-12">
                <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center space-x-2">
                        <i className="fa-solid fa-heart text-rose-500"></i>
                        <span>Mandujano Family Reunion Platform 2027–2028</span>
                    </div>
                    <div className="text-slate-500">
                        Built for Matriarch Olga Mandujano & Descendants • La Ensenada Beach Resort, Tela, Honduras
                    </div>
                </div>
            </footer>
        </div>
    );
}

// --- COUNTDOWN TIMER COMPONENT ---
function CountdownTimer({ targetDate }) {
    const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

    useEffect(() => {
        const target = new Date(targetDate).getTime();
        const interval = setInterval(() => {
            const now = new Date().getTime();
            const difference = target - now;

            if (difference <= 0) {
                clearInterval(interval);
            } else {
                const days = Math.floor(difference / (1000 * 60 * 60 * 24));
                const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((difference % (1000 * 60)) / 1000);
                setTimeLeft({ days, hours, minutes, seconds });
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [targetDate]);

    return (
        <div className="grid grid-cols-4 gap-2 text-center pt-1">
            <div className="bg-slate-800/90 rounded-lg p-2 border border-slate-700">
                <span className="text-xl sm:text-2xl font-black text-amber-400 font-mono">{timeLeft.days}</span>
                <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wider">Days</span>
            </div>
            <div className="bg-slate-800/90 rounded-lg p-2 border border-slate-700">
                <span className="text-xl sm:text-2xl font-black text-amber-400 font-mono">{timeLeft.hours}</span>
                <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wider">Hours</span>
            </div>
            <div className="bg-slate-800/90 rounded-lg p-2 border border-slate-700">
                <span className="text-xl sm:text-2xl font-black text-amber-400 font-mono">{timeLeft.minutes}</span>
                <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wider">Mins</span>
            </div>
            <div className="bg-slate-800/90 rounded-lg p-2 border border-slate-700">
                <span className="text-xl sm:text-2xl font-black text-amber-400 font-mono">{timeLeft.seconds}</span>
                <span className="block text-[10px] text-slate-400 font-medium uppercase tracking-wider">Secs</span>
            </div>
        </div>
    );
}

// --- UNIVERSAL AVATAR WITH TOUCH-FRIENDLY CLOUD STORAGE UPLOAD ---
function UniversalAvatar({ person, onUpdatePhoto, size = 'md', className = '', gender = 'female' }) {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 8 * 1024 * 1024) {
            alert('Please select an image smaller than 8MB.');
            return;
        }

        try {
            setUploading(true);
            if (window.storage) {
                const storageRef = window.storage.ref(`avatars/${person.id}_${Date.now()}_${file.name}`);
                const snapshot = await storageRef.put(file);
                const downloadURL = await snapshot.ref.getDownloadURL();
                onUpdatePhoto(person.id, downloadURL);
            } else {
                const reader = new FileReader();
                reader.onload = (event) => {
                    onUpdatePhoto(person.id, event.target.result);
                };
                reader.readAsDataURL(file);
            }
            setUploading(false);
        } catch (err) {
            console.error("Storage upload error:", err);
            setUploading(false);
            alert("Error uploading image to Cloud Storage. Please check storage rules.");
        }
    };

    const sizeClasses = {
        sm: 'w-10 h-10 text-xs',
        md: 'w-16 h-16 text-sm',
        lg: 'w-24 h-24 text-base',
        xl: 'w-28 h-28 text-lg'
    };

    const imgSrc = person.photo || getDefaultAvatar(person.name, gender);

    return (
        <div className={`relative group inline-block ${className}`}>
            <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept="image/*" 
                className="hidden" 
            />
            <div className={`${sizeClasses[size] || sizeClasses.md} rounded-full overflow-hidden border-2 border-amber-400/80 shadow-md relative bg-slate-200 flex-shrink-0`}>
                <img 
                    src={imgSrc} 
                    alt={person.name} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                />
                
                {/* Uploading Spinner Overlay */}
                {uploading && (
                    <div className="absolute inset-0 bg-slate-900/70 text-white flex flex-col items-center justify-center backdrop-blur-[1px]">
                        <i className="fa-solid fa-spinner fa-spin text-amber-300 text-base"></i>
                    </div>
                )}
            </div>

            {/* Permanent Touch-Friendly Camera Badge */}
            <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                title="Upload Photo"
                className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-slate-900/90 text-amber-400 border-2 border-amber-300 flex items-center justify-center text-xs shadow-lg hover:scale-110 active:scale-95 transition z-10"
            >
                <i className="fa-solid fa-camera"></i>
            </button>
        </div>
    );
}

// --- SYMMETRICAL TREE VIEW ---
function SymmetricalTreeView({ familyData, onSelectSibling, onUpdatePhoto, t }) {
    const { sisters, brothers } = familyData;

    return (
        <div className="space-y-10">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                    <span className="px-3 py-1 bg-tropical-100 text-tropical-800 text-xs font-bold rounded-full uppercase tracking-wider">
                        {t.gen2LayoutTag || "2nd Generation Symmetrical Layout"}
                    </span>
                    <h2 className="text-xl sm:text-2xl font-bold font-serif-title text-slate-900 mt-1">
                        {t.treeTitle || "Mandujano Lineage Tree"}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-500">
                        {t.treeSubtitle || "5 Sisters on Left • 5 Brothers on Right. Click any sibling to view or manage 3rd & 4th Generation descendants."}
                    </p>
                </div>
                <div className="flex items-center gap-2 bg-amber-50 text-amber-900 px-4 py-2 rounded-xl text-xs font-medium border border-amber-200">
                    <i className="fa-solid fa-camera text-amber-600 text-sm"></i>
                    <span>{t.avatarHoverHint || "Hover over ANY avatar to upload/change photos!"}</span>
                </div>
            </div>

            <div className="relative bg-white/80 backdrop-blur rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200 overflow-x-auto custom-scrollbar">
                <div className="flex items-center justify-center mb-6">
                    <div className="h-8 w-0.5 bg-gradient-to-b from-amber-400 to-tropical-500"></div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 relative z-10">
                    <div className="space-y-4">
                        <div className="bg-gradient-to-r from-pink-500 to-rose-500 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-center shadow flex items-center justify-center gap-2">
                            <span>{t.sisterWing}</span>
                        </div>
                        <div className="space-y-3">
                            {sisters.map(sister => (
                                <SiblingCard 
                                    key={sister.id} 
                                    sibling={sister} 
                                    onSelectSibling={onSelectSibling}
                                    onUpdatePhoto={onUpdatePhoto}
                                    type="sister"
                                    t={t}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="bg-gradient-to-r from-blue-600 to-tropical-600 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-center shadow flex items-center justify-center gap-2">
                            <span>{t.brotherWing}</span>
                        </div>
                        <div className="space-y-3">
                            {brothers.map(brother => (
                                <SiblingCard 
                                    key={brother.id} 
                                    sibling={brother} 
                                    onSelectSibling={onSelectSibling}
                                    onUpdatePhoto={onUpdatePhoto}
                                    type="brother"
                                    t={t}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- SIBLING CARD COMPONENT ---
function SiblingCard({ sibling, onSelectSibling, onUpdatePhoto, type, t }) {
    const gen3Count = sibling.children ? sibling.children.length : 0;
    let gen4Count = 0;
    if (sibling.children) {
        sibling.children.forEach(c => {
            if (c.children) gen4Count += c.children.length;
        });
    }

    const badgeColor = type === 'sister' 
        ? 'bg-rose-100 text-rose-800 border-rose-200' 
        : 'bg-blue-100 text-blue-800 border-blue-200';

    return (
        <div className="bg-white border border-slate-200 hover:border-tropical-500 rounded-2xl p-4 shadow-sm hover:shadow-lg transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 card-glow group">
            <div className="flex items-center space-x-3 sm:space-x-4 min-w-0">
                <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border font-bold text-xs flex items-center justify-center shrink-0 ${badgeColor}`}>
                    #{sibling.order}
                </div>

                <UniversalAvatar 
                    person={sibling} 
                    onUpdatePhoto={onUpdatePhoto} 
                    size="md" 
                    gender={type === 'sister' ? 'female' : 'male'}
                />

                <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-slate-900 group-hover:text-tropical-700 transition-colors text-sm sm:text-base flex items-center gap-2 truncate">
                        <span className="truncate">{sibling.name}</span>
                        {sibling.whatsapp && (
                            <a 
                                href={`https://wa.me/${sibling.whatsapp.replace(/[^0-9]/g, '')}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                title={t.whatsappContact}
                                className="text-emerald-500 hover:text-emerald-600 text-sm shrink-0"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <i className="fa-brands fa-whatsapp"></i>
                            </a>
                        )}
                    </h4>
                    {sibling.spouse ? (
                        <div className="flex items-center space-x-1.5 text-xs text-slate-500 mt-0.5 truncate">
                            <i className="fa-solid fa-heart text-rose-400 text-[10px] shrink-0"></i>
                            <span className="truncate">{t.spouse}: <strong>{sibling.spouse}</strong></span>
                        </div>
                    ) : (
                        <span className="text-[11px] text-slate-400 italic block">{t.noSpouse}</span>
                    )}

                    <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                        <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">
                            <i className="fa-solid fa-child text-tropical-600 mr-1"></i>
                            {gen3Count} {t.childrenCount}
                        </span>
                        {gen4Count > 0 && (
                            <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md border border-amber-200">
                                <i className="fa-solid fa-baby text-amber-500 mr-1"></i>
                                {gen4Count} {t.bisnietosCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <button 
                onClick={() => onSelectSibling(sibling.id)}
                className="w-full sm:w-auto shrink-0 bg-tropical-50 hover:bg-tropical-500 text-tropical-700 hover:text-white px-3.5 py-2 rounded-xl text-xs font-semibold border border-tropical-200 hover:border-tropical-500 transition flex items-center justify-center gap-1.5 shadow-sm"
            >
                <span>{t.exploreBranch}</span>
                <i className="fa-solid fa-chevron-right text-[10px]"></i>
            </button>
        </div>
    );
}

// --- BRANCH DRILL-DOWN MODAL ---
function BranchDrillDownModal({ sibling, onClose, onUpdatePhoto, onUpdateProfile, onAdd3rdGen, onAdd4thGen, onRequestDeleteMember, t, lang }) {
    const [showAdd3rdModal, setShowAdd3rdModal] = useState(false);
    const [selectedParentFor4th, setSelectedParentFor4th] = useState(null);

    const [isEditingSibling, setIsEditingSibling] = useState(false);
    const [editedSibName, setEditedSibName] = useState(sibling.name || '');
    const [editedSibSpouse, setEditedSibSpouse] = useState(sibling.spouse || '');
    const [editedSibWhatsapp, setEditedSibWhatsapp] = useState(sibling.whatsapp || '');
    const [editedSibNote, setEditedSibNote] = useState(sibling.note || '');

    useEffect(() => {
        setEditedSibName(sibling.name || '');
        setEditedSibSpouse(sibling.spouse || '');
        setEditedSibWhatsapp(sibling.whatsapp || '');
        setEditedSibNote(sibling.note || '');
        setIsEditingSibling(false);
    }, [sibling]);

    const handleSaveSiblingProfile = () => {
        onUpdateProfile(sibling.id, {
            name: editedSibName,
            spouse: editedSibSpouse,
            whatsapp: editedSibWhatsapp,
            note: editedSibNote
        });
        setIsEditingSibling(false);
    };

    // 3rd Gen Form State
    const [new3rdName, setNew3rdName] = useState('');
    const [new3rdSpouse, setNew3rdSpouse] = useState('');
    const [new3rdWhatsapp, setNew3rdWhatsapp] = useState('');
    const [new3rdPhoto, setNew3rdPhoto] = useState('');

    // 4th Gen Form State
    const [new4thName, setNew4thName] = useState('');
    const [new4thAge, setNew4thAge] = useState('');
    const [new4thGender, setNew4thGender] = useState('female');
    const [new4thWhatsapp, setNew4thWhatsapp] = useState('');
    const [new4thPhoto, setNew4thPhoto] = useState('');

    const handle3rdPhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (window.storage) {
            const storageRef = window.storage.ref(`gen3/${Date.now()}_${file.name}`);
            const snap = await storageRef.put(file);
            const url = await snap.ref.getDownloadURL();
            setNew3rdPhoto(url);
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => setNew3rdPhoto(ev.target.result);
            reader.readAsDataURL(file);
        }
    };

    const handle4thPhotoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (window.storage) {
            const storageRef = window.storage.ref(`gen4/${Date.now()}_${file.name}`);
            const snap = await storageRef.put(file);
            const url = await snap.ref.getDownloadURL();
            setNew4thPhoto(url);
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => setNew4thPhoto(ev.target.result);
            reader.readAsDataURL(file);
        }
    };

    const submit3rdGen = (e) => {
        e.preventDefault();
        if (!new3rdName.trim()) return;
        onAdd3rdGen({
            name: new3rdName,
            spouse: new3rdSpouse,
            whatsapp: new3rdWhatsapp,
            photo: new3rdPhoto
        });
        setNew3rdName('');
        setNew3rdSpouse('');
        setNew3rdWhatsapp('');
        setNew3rdPhoto('');
        setShowAdd3rdModal(false);
    };

    const submit4thGen = (e) => {
        e.preventDefault();
        if (!new4thName.trim() || !selectedParentFor4th) return;
        onAdd4thGen(selectedParentFor4th, {
            name: new4thName,
            age: new4thAge,
            gender: new4thGender,
            whatsapp: new4thWhatsapp,
            photo: new4thPhoto
        });
        setNew4thName('');
        setNew4thAge('');
        setNew4thWhatsapp('');
        setNew4thPhoto('');
        setSelectedParentFor4th(null);
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in duration-200">
                <div className="bg-gradient-to-r from-caribbean-dark to-tropical-900 text-white p-5 sm:p-6 relative">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
                        <button 
                            onClick={onClose}
                            className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-xl border border-white/20 transition cursor-pointer"
                        >
                            <i className="fa-solid fa-arrow-left"></i>
                            <span>{lang === 'es' ? '← Volver al Árbol' : '← Back to Family Tree'}</span>
                        </button>
                        <button 
                            onClick={onClose}
                            className="text-slate-400 hover:text-white bg-white/10 w-8 h-8 rounded-full flex items-center justify-center transition"
                        >
                            <i className="fa-solid fa-xmark text-base"></i>
                        </button>
                    </div>
                    <div className="flex items-center space-x-4">
                        <UniversalAvatar 
                            person={sibling} 
                            onUpdatePhoto={onUpdatePhoto} 
                            size="lg" 
                            gender={sibling.type === 'sister' ? 'female' : 'male'}
                        />
                        <div className="flex-1">
                            <div className="flex items-center space-x-2">
                                <span className="bg-amber-400 text-slate-900 text-xs font-bold px-2 py-0.5 rounded">
                                    Sibling #{sibling.order}
                                </span>
                                <span className="text-tropical-300 text-xs uppercase tracking-wider font-semibold">
                                    Branch Tree
                                </span>
                                <button 
                                    type="button"
                                    onClick={() => setIsEditingSibling(!isEditingSibling)}
                                    className="text-amber-300 hover:text-amber-100 text-xs font-semibold underline flex items-center gap-1 ml-2"
                                >
                                    <i className="fa-solid fa-pen-to-square"></i> {t.editMember}
                                </button>
                            </div>

                            {!isEditingSibling ? (
                                <div>
                                    <h3 className="text-2xl font-extrabold font-serif-title text-white mt-1 flex items-center gap-2">
                                        <span>{sibling.name}</span>
                                        {sibling.whatsapp && (
                                            <a 
                                                href={`https://wa.me/${sibling.whatsapp.replace(/[^0-9]/g, '')}`} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow transition"
                                            >
                                                <i className="fa-brands fa-whatsapp"></i> WhatsApp
                                            </a>
                                        )}
                                    </h3>
                                    <p className="text-xs text-tropical-200 mt-0.5">
                                        <i className="fa-solid fa-heart text-rose-400 mr-1"></i>
                                        {t.spouse}: <strong className="text-white">{sibling.spouse || t.noSpouse}</strong>
                                    </p>
                                </div>
                            ) : (
                                <div className="mt-2 space-y-2 bg-slate-900/90 p-3 rounded-xl border border-amber-400/40">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <input 
                                            type="text" 
                                            value={editedSibName}
                                            onChange={(e) => setEditedSibName(e.target.value)}
                                            placeholder="Full Name"
                                            className="text-xs p-2 rounded bg-slate-800 text-white border border-slate-700 outline-none"
                                        />
                                        <input 
                                            type="text" 
                                            value={editedSibSpouse}
                                            onChange={(e) => setEditedSibSpouse(e.target.value)}
                                            placeholder="Spouse Name"
                                            className="text-xs p-2 rounded bg-slate-800 text-white border border-slate-700 outline-none"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <input 
                                            type="text" 
                                            value={editedSibWhatsapp}
                                            onChange={(e) => setEditedSibWhatsapp(e.target.value)}
                                            placeholder="WhatsApp (e.g. +50499998888)"
                                            className="text-xs p-2 rounded bg-slate-800 text-white border border-slate-700 outline-none"
                                        />
                                        <div className="flex items-center justify-end space-x-2">
                                            <button 
                                                onClick={() => setIsEditingSibling(false)}
                                                className="px-3 py-1 bg-slate-700 text-xs font-semibold rounded text-slate-300"
                                            >
                                                {t.cancel}
                                            </button>
                                            <button 
                                                onClick={handleSaveSiblingProfile}
                                                className="px-3 py-1 bg-emerald-600 text-xs font-bold rounded text-white shadow"
                                            >
                                                {t.saveChanges}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="bg-slate-100 px-6 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                    <div className="text-xs text-slate-600 font-medium">
                        <i className="fa-solid fa-sitemap text-tropical-600 mr-1.5"></i>
                        3rd Generation Children & 4th Generation Great-Grandchildren
                    </div>
                    <button 
                        onClick={() => setShowAdd3rdModal(true)}
                        className="bg-tropical-600 hover:bg-tropical-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow flex items-center gap-1.5"
                    >
                        <i className="fa-solid fa-plus"></i> Add 3rd Gen Child
                    </button>
                </div>

                <div className="p-6 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-6">
                    {(!sibling.children || sibling.children.length === 0) ? (
                        <div className="text-center py-12 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                            <i className="fa-solid fa-users text-4xl text-slate-300 mb-2"></i>
                            <p className="text-slate-600 font-semibold text-sm">No 3rd generation children recorded yet.</p>
                            <p className="text-xs text-slate-400 mt-1">Click 'Add 3rd Gen Child' above to start building this branch!</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {sibling.children.map((child) => (
                                <div key={child.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm relative">
                                    <button 
                                        onClick={() => onRequestDeleteMember(child.id, 3)}
                                        title={t.deleteMember}
                                        className="absolute top-4 right-4 text-slate-400 hover:text-rose-600 p-1.5 transition text-xs"
                                    >
                                        <i className="fa-solid fa-trash"></i>
                                    </button>

                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                                        <div className="flex items-center space-x-4">
                                            <UniversalAvatar 
                                                person={child} 
                                                onUpdatePhoto={onUpdatePhoto} 
                                                size="md" 
                                                gender="male"
                                            />
                                            <div>
                                                <span className="text-[10px] font-bold bg-tropical-100 text-tropical-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                    3rd Generation (Nieto)
                                                </span>
                                                <h4 className="font-bold text-slate-900 text-base mt-0.5 flex items-center gap-2">
                                                    <span>{child.name}</span>
                                                    {child.whatsapp && (
                                                        <a 
                                                            href={`https://wa.me/${child.whatsapp.replace(/[^0-9]/g, '')}`} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-emerald-500 hover:text-emerald-600 text-xs"
                                                            title={t.whatsappContact}
                                                        >
                                                            <i className="fa-brands fa-whatsapp"></i>
                                                        </a>
                                                    )}
                                                </h4>
                                                {child.spouse ? (
                                                    <div className="flex items-center space-x-3 text-xs text-slate-500 mt-0.5">
                                                        <span><i className="fa-solid fa-heart text-rose-400 text-[10px]"></i> {t.spouse}: {child.spouse}</span>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-slate-400 italic">{t.noSpouse}</span>
                                                )}
                                            </div>
                                        </div>

                                        <button 
                                            onClick={() => setSelectedParentFor4th(child.id)}
                                            className="bg-amber-500 hover:bg-amber-600 text-slate-900 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-sm flex items-center justify-center gap-1.5 self-start sm:self-center"
                                        >
                                            <i className="fa-solid fa-baby"></i> Add 4th Gen (Bisnieto)
                                        </button>
                                    </div>

                                    <div className="mt-4 pl-4 sm:pl-6 border-l-2 border-amber-300 space-y-3">
                                        <h5 className="text-xs font-bold text-amber-700 uppercase tracking-wider flex items-center gap-1">
                                            <i className="fa-solid fa-child-reaching text-amber-500"></i>
                                            4th Generation Great-Grandchildren ({child.children ? child.children.length : 0})
                                        </h5>

                                        {(!child.children || child.children.length === 0) ? (
                                            <p className="text-xs text-slate-400 italic">No 4th generation children added yet under {child.name}.</p>
                                        ) : (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {child.children.map(gchild => (
                                                    <div key={gchild.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between shadow-sm relative group">
                                                        <div className="flex items-center space-x-3">
                                                            <UniversalAvatar 
                                                                person={gchild} 
                                                                onUpdatePhoto={onUpdatePhoto} 
                                                                size="sm" 
                                                                gender={gchild.gender || 'female'}
                                                            />
                                                            <div>
                                                                <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                                                    <span>{gchild.name}</span>
                                                                    {gchild.whatsapp && (
                                                                        <a 
                                                                            href={`https://wa.me/${gchild.whatsapp.replace(/[^0-9]/g, '')}`} 
                                                                            target="_blank" 
                                                                            rel="noopener noreferrer"
                                                                            className="text-emerald-500 text-xs"
                                                                        >
                                                                            <i className="fa-brands fa-whatsapp"></i>
                                                                        </a>
                                                                    )}
                                                                </p>
                                                                <span className="text-[10px] text-slate-500 font-medium">Age: {gchild.age || 'N/A'} yrs</span>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={() => onRequestDeleteMember(gchild.id, 4)}
                                                            className="text-slate-300 hover:text-rose-600 transition p-1"
                                                            title={t.deleteMember}
                                                        >
                                                            <i className="fa-solid fa-trash text-xs"></i>
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-slate-50 p-4 border-t border-slate-200 text-right">
                    <button 
                        onClick={onClose}
                        className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2 rounded-xl text-xs font-bold transition shadow"
                    >
                        Done Viewing
                    </button>
                </div>
            </div>

            {/* SUB-MODAL: ADD 3RD GEN */}
            {showAdd3rdModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
                        <h3 className="text-lg font-bold text-slate-900 font-serif-title mb-1">
                            Add 3rd Gen Child (Grandchild)
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">Adding child under {sibling.name}</p>
                        
                        <form onSubmit={submit3rdGen} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name</label>
                                <input 
                                    type="text" 
                                    required
                                    value={new3rdName}
                                    onChange={(e) => setNew3rdName(e.target.value)}
                                    placeholder="e.g. Oscar Alfredo Matute"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Spouse Name (Optional)</label>
                                <input 
                                    type="text" 
                                    value={new3rdSpouse}
                                    onChange={(e) => setNew3rdSpouse(e.target.value)}
                                    placeholder="e.g. Ana Lucia"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">WhatsApp Number (Optional)</label>
                                <input 
                                    type="text" 
                                    value={new3rdWhatsapp}
                                    onChange={(e) => setNew3rdWhatsapp(e.target.value)}
                                    placeholder="e.g. +50499998888"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Photo Upload</label>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={handle3rdPhotoUpload}
                                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-tropical-50 file:text-tropical-700 hover:file:bg-tropical-100"
                                />
                                {new3rdPhoto && (
                                    <img src={new3rdPhoto} alt="Preview" className="w-12 h-12 rounded-full object-cover mt-2 border" />
                                )}
                            </div>

                            <div className="flex justify-end space-x-2 pt-2">
                                <button 
                                    type="button"
                                    onClick={() => setShowAdd3rdModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
                                >
                                    {t.cancel}
                                </button>
                                <button 
                                    type="submit"
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-tropical-600 hover:bg-tropical-700 shadow"
                                >
                                    Save Child
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* SUB-MODAL: ADD 4TH GEN */}
            {selectedParentFor4th && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
                        <h3 className="text-lg font-bold text-slate-900 font-serif-title mb-1">
                            Add 4th Gen Great-Grandchild
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">Adding bisnieto/bisnieta</p>
                        
                        <form onSubmit={submit4thGen} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Full Name</label>
                                <input 
                                    type="text" 
                                    required
                                    value={new4thName}
                                    onChange={(e) => setNew4thName(e.target.value)}
                                    placeholder="e.g. Mateo Matute"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-amber-500 outline-none"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Age</label>
                                    <input 
                                        type="number" 
                                        min="0" 
                                        max="100" 
                                        required
                                        value={new4thAge}
                                        onChange={(e) => setNew4thAge(e.target.value)}
                                        placeholder="e.g. 5"
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-amber-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Gender</label>
                                    <select 
                                        value={new4thGender}
                                        onChange={(e) => setNew4thGender(e.target.value)}
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-amber-500 outline-none bg-white"
                                    >
                                        <option value="female">Female</option>
                                        <option value="male">Male</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">WhatsApp Number (Optional)</label>
                                <input 
                                    type="text" 
                                    value={new4thWhatsapp}
                                    onChange={(e) => setNew4thWhatsapp(e.target.value)}
                                    placeholder="e.g. +50499998888"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-amber-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Photo Upload</label>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    onChange={handle4thPhotoUpload}
                                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
                                />
                                {new4thPhoto && (
                                    <img src={new4thPhoto} alt="Preview" className="w-12 h-12 rounded-full object-cover mt-2 border" />
                                )}
                            </div>

                            <div className="flex justify-end space-x-2 pt-2">
                                <button 
                                    type="button"
                                    onClick={() => setSelectedParentFor4th(null)}
                                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
                                >
                                    {t.cancel}
                                </button>
                                <button 
                                    type="submit"
                                    className="px-4 py-2 rounded-xl text-xs font-bold text-slate-900 bg-amber-400 hover:bg-amber-500 shadow"
                                >
                                    Save Bisnieto
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- RESORT & COST ESTIMATOR VIEW ---
function ResortCostEstimatorView({ familyData, t }) {
    const [selectedBranchId, setSelectedBranchId] = useState('all');
    const [adultCount, setAdultCount] = useState(2);
    const [childCount, setChildCount] = useState(1);

    const PRICE_PER_ADULT = 565;
    const PRICE_PER_CHILD = 0;

    const allSiblings = useMemo(() => [...familyData.sisters, ...familyData.brothers], [familyData]);

    useEffect(() => {
        if (selectedBranchId === 'custom') return;

        if (selectedBranchId === 'all') {
            let adults = 1;
            let childrenUnder14 = 0;

            allSiblings.forEach(sib => {
                adults += 1;
                if (sib.spouse) adults += 1;
                if (sib.children) {
                    sib.children.forEach(c => {
                        adults += 1;
                        if (c.spouse) adults += 1;
                        if (c.children) {
                            c.children.forEach(gc => {
                                if (gc.age <= 14) childrenUnder14 += 1;
                                else adults += 1;
                            });
                        }
                    });
                }
            });
            setAdultCount(adults);
            setChildCount(childrenUnder14);
        } else {
            const sib = allSiblings.find(s => s.id === selectedBranchId);
            if (sib) {
                let adults = 1;
                if (sib.spouse) adults += 1;
                let childrenUnder14 = 0;

                if (sib.children) {
                    sib.children.forEach(c => {
                        adults += 1;
                        if (c.spouse) adults += 1;
                        if (c.children) {
                            c.children.forEach(gc => {
                                if (gc.age <= 14) childrenUnder14 += 1;
                                else adults += 1;
                            });
                        }
                    });
                }
                setAdultCount(adults);
                setChildCount(childrenUnder14);
            }
        }
    }, [selectedBranchId, allSiblings]);

    const totalAdultCost = adultCount * PRICE_PER_ADULT;
    const totalChildCost = childCount * PRICE_PER_CHILD;
    const totalEstimatedCost = totalAdultCost + totalChildCost;
    const monthlyPayment = Math.ceil(totalEstimatedCost / 16);

    return (
        <div className="space-y-8">
            <div className="bg-gradient-to-r from-tropical-900 via-caribbean-dark to-slate-900 text-white rounded-3xl p-8 shadow-xl relative overflow-hidden">
                <div className="absolute right-0 top-0 w-96 h-96 bg-tropical-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <div className="relative z-10 max-w-3xl">
                    <span className="px-3 py-1 bg-amber-400 text-slate-900 text-xs font-bold rounded-full uppercase tracking-wider">
                        {t.estimatorTag || "Reunion Package Estimator"}
                    </span>
                    <h2 className="text-2xl sm:text-4xl font-extrabold font-serif-title mt-2">
                        La Ensenada Beach Resort, Tela
                    </h2>
                    <p className="text-tropical-200 text-sm mt-2">
                        Dec 30, 2027 – Jan 2, 2028 (4 Days / 3 Nights All-Inclusive). Calculate package cost for your nuclear family or full branch.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-7 bg-white rounded-3xl p-6 shadow-md border border-slate-200 space-y-6">
                    <h3 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
                        <i className="fa-solid fa-calculator text-tropical-600"></i>
                        {t.selectBranchGuest || "Select Family Branch & Guest Count"}
                    </h3>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase mb-2">
                            {t.presetBranchLabel || "Preset Branch Auto-Fill"}
                        </label>
                        <select 
                            value={selectedBranchId}
                            onChange={(e) => setSelectedBranchId(e.target.value)}
                            className="w-full text-sm p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-slate-50 font-medium"
                        >
                            <option value="all">{t.entireTreeOption || "Entire Mandujano Legacy Tree (All Descendants)"}</option>
                            <option value="custom">{t.customCalcOption || "Custom Manual Calculation"}</option>
                            <optgroup label="Sisters Branches">
                                {familyData.sisters.map(s => (
                                    <option key={s.id} value={s.id}>Branch #{s.order}: {s.name}</option>
                                ))}
                            </optgroup>
                            <optgroup label="Brothers Branches">
                                {familyData.brothers.map(b => (
                                    <option key={b.id} value={b.id}>Branch #{b.order}: {b.name}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <p className="text-sm font-bold text-slate-900">{t.adultsLabel || "Adults & Teens (15+)"}</p>
                                    <p className="text-xs text-slate-500">${PRICE_PER_ADULT} per person</p>
                                </div>
                                <i className="fa-solid fa-user text-tropical-600 text-lg"></i>
                            </div>
                            <div className="flex items-center space-x-3">
                                <button 
                                    onClick={() => setAdultCount(Math.max(1, adultCount - 1))}
                                    className="w-9 h-9 rounded-xl bg-white border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 transition shadow-sm"
                                >
                                    -
                                </button>
                                <span className="text-xl font-bold text-slate-900 w-10 text-center">{adultCount}</span>
                                <button 
                                    onClick={() => setAdultCount(adultCount + 1)}
                                    className="w-9 h-9 rounded-xl bg-white border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 transition shadow-sm"
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-200">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <p className="text-sm font-bold text-slate-900">{t.childrenLabel || "Children (0 - 14 yrs)"}</p>
                                    <p className="text-xs text-amber-700 font-bold">FREE ($0 per child)</p>
                                </div>
                                <i className="fa-solid fa-child text-amber-600 text-lg"></i>
                            </div>
                            <div className="flex items-center space-x-3">
                                <button 
                                    onClick={() => setChildCount(Math.max(0, childCount - 1))}
                                    className="w-9 h-9 rounded-xl bg-white border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 transition shadow-sm"
                                >
                                    -
                                </button>
                                <span className="text-xl font-bold text-slate-900 w-10 text-center">{childCount}</span>
                                <button 
                                    onClick={() => setChildCount(childCount + 1)}
                                    className="w-9 h-9 rounded-xl bg-white border border-slate-300 font-bold text-slate-700 hover:bg-slate-100 transition shadow-sm"
                                >
                                    +
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="pt-2">
                        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">
                            {t.perksIncludedLabel || "All-Inclusive Reunion Perks Included:"}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-600">
                            <div className="flex items-center gap-2"><i className="fa-solid fa-check text-emerald-500"></i> Oceanfront Luxury Rooms</div>
                            <div className="flex items-center gap-2"><i className="fa-solid fa-check text-emerald-500"></i> All Meals & Buffet Dining</div>
                            <div className="flex items-center gap-2"><i className="fa-solid fa-check text-emerald-500"></i> Unlimited Beverages & Drinks</div>
                            <div className="flex items-center gap-2"><i className="fa-solid fa-check text-emerald-500"></i> Mandujano Gala Celebration Night</div>
                            <div className="flex items-center gap-2"><i className="fa-solid fa-check text-emerald-500"></i> Private Beach Pavilion Access</div>
                            <div className="flex items-center gap-2"><i className="fa-solid fa-check text-emerald-500"></i> Resort Kids Club & Waterpark</div>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-5 bg-gradient-to-b from-slate-900 to-caribbean-dark text-white rounded-3xl p-6 shadow-xl border border-slate-800 flex flex-col justify-between">
                    <div>
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-widest block mb-1">
                            Cost Breakdown Summary
                        </span>
                        <h3 className="text-2xl font-bold font-serif-title text-white">
                            {t.estimatedTotalCostTitle || "Estimated Total Cost"}
                        </h3>

                        <div className="my-6 space-y-3 border-y border-slate-800 py-4">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-300">{adultCount} Adults @ ${PRICE_PER_ADULT}</span>
                                <span className="font-bold text-white">${totalAdultCost.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-300">{childCount} Children (Up to 14 yrs)</span>
                                <span className="font-bold text-emerald-400">$0 (FREE)</span>
                            </div>
                            <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-lg font-bold">
                                <span className="text-amber-300">Total All-Inclusive Package</span>
                                <span className="text-2xl font-serif-title text-amber-400">${totalEstimatedCost.toLocaleString()}</span>
                            </div>
                        </div>

                        <div className="bg-slate-800/80 p-4 rounded-2xl border border-slate-700/60">
                            <p className="text-xs font-bold text-tropical-300 uppercase tracking-wider mb-1">
                                {t.suggestedPaymentPlanTitle || "Suggested Payment Plan (16 Months)"}
                            </p>
                            <p className="text-xl font-extrabold text-white font-mono">
                                ${monthlyPayment} <span className="text-xs font-sans text-slate-400 font-normal">/ month</span>
                            </p>
                            <p className="text-[11px] text-slate-400 mt-1">
                                Lock in early rates by setting up automated installments.
                            </p>
                        </div>
                    </div>

                    <div className="pt-6">
                        <button 
                            onClick={() => alert(`Package quote of $${totalEstimatedCost} for ${adultCount} adults & ${childCount} children saved to your session!`)}
                            className="w-full bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-900 font-bold py-3.5 rounded-xl shadow-lg transition text-sm flex items-center justify-center gap-2"
                        >
                            <i className="fa-solid fa-file-invoice-dollar"></i>
                            {t.reserveEstimateBtn || "Reserve / Save Estimate"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- DIRECTORY VIEW ---
function DirectoryView({ familyData, searchQuery, setSearchQuery, onUpdatePhoto, onSelectSibling, t }) {
    const [selectedGenFilter, setSelectedGenFilter] = useState('all');

    const allMembers = useMemo(() => {
        const list = [];
        const { patriarch, matriarch, sisters, brothers } = familyData;

        list.push({ ...patriarch, relationship: '1st Gen Patriarch' });
        list.push({ ...matriarch, relationship: '1st Gen Matriarch' });

        const processSibling = (sib) => {
            list.push({
                id: sib.id,
                name: sib.name,
                gen: 2,
                type: sib.type,
                photo: sib.photo,
                relationship: `2nd Gen (${sib.type === 'sister' ? 'Sister' : 'Brother'} #${sib.order})`,
                spouse: sib.spouse,
                whatsapp: sib.whatsapp,
                siblingId: sib.id
            });

            if (sib.children) {
                sib.children.forEach(c => {
                    list.push({
                        id: c.id,
                        name: c.name,
                        gen: 3,
                        photo: c.photo,
                        spouse: c.spouse,
                        whatsapp: c.whatsapp,
                        relationship: `3rd Gen (Child of ${sib.name})`,
                        siblingId: sib.id
                    });

                    if (c.children) {
                        c.children.forEach(gc => {
                            list.push({
                                id: gc.id,
                                name: gc.name,
                                gen: 4,
                                photo: gc.photo,
                                age: gc.age,
                                gender: gc.gender,
                                whatsapp: gc.whatsapp,
                                relationship: `4th Gen (Bisnieto of ${sib.name})`,
                                siblingId: sib.id
                            });
                        });
                    }
                });
            }
        };

        sisters.forEach(processSibling);
        brothers.forEach(processSibling);

        return list;
    }, [familyData]);

    const filtered = useMemo(() => {
        return allMembers.filter(m => {
            const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                  (m.spouse && m.spouse.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                  (m.relationship && m.relationship.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesGen = selectedGenFilter === 'all' || m.gen.toString() === selectedGenFilter;
            return matchesSearch && matchesGen;
        });
    }, [allMembers, searchQuery, selectedGenFilter]);

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="w-full sm:w-auto">
                    <h2 className="text-xl font-bold font-serif-title text-slate-900">
                        {t.directoryTitle || "Mandujano Family Directory"}
                    </h2>
                    <p className="text-xs text-slate-500">Search all {allMembers.length} recorded family members across 4 generations.</p>
                </div>

                <div className="flex items-center flex-wrap sm:flex-nowrap gap-3 w-full sm:w-auto">
                    <select 
                        value={selectedGenFilter}
                        onChange={(e) => setSelectedGenFilter(e.target.value)}
                        className="text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-slate-50 font-medium"
                    >
                        <option value="all">{t.allGensOption || "All Generations (1st - 4th)"}</option>
                        <option value="1">1st Gen (Olga & Carlos)</option>
                        <option value="2">2nd Gen (10 Siblings)</option>
                        <option value="3">3rd Gen (Grandchildren)</option>
                        <option value="4">4th Gen (Great-Grandchildren)</option>
                    </select>

                    <div className="relative w-full sm:w-64">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-3 text-slate-400 text-xs"></i>
                        <input 
                            type="text" 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t.searchPlaceholder || "Search by name..."}
                            className="w-full text-xs pl-8 pr-3 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filtered.map(member => (
                    <div key={member.id} className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm hover:shadow-md transition flex items-center space-x-3 group relative">
                        <UniversalAvatar 
                            person={member} 
                            onUpdatePhoto={onUpdatePhoto} 
                            size="md" 
                            gender={member.gender || 'female'}
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-tropical-700 bg-tropical-50 px-2 py-0.5 rounded border border-tropical-100">
                                    Gen {member.gen}
                                </span>
                                {member.whatsapp && (
                                    <a 
                                        href={`https://wa.me/${member.whatsapp.replace(/[^0-9]/g, '')}`} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        className="text-emerald-500 hover:text-emerald-600 text-xs"
                                        title={t.whatsappContact}
                                    >
                                        <i className="fa-brands fa-whatsapp"></i>
                                    </a>
                                )}
                            </div>
                            <h4 className="font-bold text-slate-900 text-sm truncate mt-1 group-hover:text-tropical-700 transition">
                                {member.name}
                            </h4>
                            <p className="text-[11px] text-slate-500 truncate">{member.relationship}</p>
                            {member.siblingId && (
                                <button 
                                    onClick={() => onSelectSibling(member.siblingId)}
                                    className="text-[10px] text-amber-600 hover:underline font-semibold mt-1 inline-block"
                                >
                                    View Branch &rarr;
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// --- RSVP & GUESTBOOK MESSAGE BOARD VIEW ---
function RSVPMessageBoardView({ familyData, onAddRSVP, onAddMessage, onLikeMessage, t }) {
    const [rsvpName, setRsvpName] = useState('');
    const [rsvpBranch, setRsvpBranch] = useState('Branch #1: Camilo Mandujano');
    const [rsvpStatus, setRsvpStatus] = useState('Attending');
    const [rsvpAdults, setRsvpAdults] = useState(2);
    const [rsvpChildren, setRsvpChildren] = useState(0);
    const [rsvpNotes, setRsvpNotes] = useState('');

    const [msgAuthor, setMsgAuthor] = useState('');
    const [msgBranch, setMsgBranch] = useState('Branch #1');
    const [msgText, setMsgText] = useState('');

    const allSiblings = useMemo(() => [...familyData.sisters, ...familyData.brothers], [familyData]);
    const rsvps = familyData.rsvps || [];
    const messages = familyData.messages || [];

    const totalAttendingGuests = useMemo(() => {
        return rsvps.filter(r => r.status === 'Attending').reduce((acc, curr) => acc + (parseInt(curr.adults) || 0) + (parseInt(curr.children) || 0), 0);
    }, [rsvps]);

    const submitRSVP = (e) => {
        e.preventDefault();
        if (!rsvpName.trim()) return;
        onAddRSVP({
            name: rsvpName,
            branch: rsvpBranch,
            status: rsvpStatus,
            adults: parseInt(rsvpAdults) || 1,
            children: parseInt(rsvpChildren) || 0,
            notes: rsvpNotes
        });
        setRsvpName('');
        setRsvpNotes('');
    };

    const submitMessage = (e) => {
        e.preventDefault();
        if (!msgAuthor.trim() || !msgText.trim()) return;
        onAddMessage({
            author: msgAuthor,
            branch: msgBranch,
            text: msgText
        });
        setMsgAuthor('');
        setMsgText('');
    };

    return (
        <div className="space-y-10">
            <div className="bg-gradient-to-r from-tropical-900 to-caribbean-dark text-white rounded-3xl p-8 shadow-xl">
                <span className="px-3 py-1 bg-amber-400 text-slate-900 text-xs font-bold rounded-full uppercase tracking-wider">
                    {t.interactiveGuestPortalTag || "Interactive Guest Portal"}
                </span>
                <h2 className="text-2xl sm:text-4xl font-extrabold font-serif-title mt-2">
                    {t.rsvpBoardTitle || "RSVP & Guestbook Message Board"}
                </h2>
                <p className="text-tropical-200 text-sm mt-2 max-w-2xl">
                    Confirm your attendance for La Ensenada Beach Resort 2027–2028 and leave your blessings and wishes for Abuela Olga and the entire family!
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-6 bg-white rounded-3xl p-6 sm:p-8 shadow-md border border-slate-200 space-y-6">
                    <div className="border-b border-slate-100 pb-4">
                        <h3 className="text-xl font-bold font-serif-title text-slate-900 flex items-center gap-2">
                            <i className="fa-solid fa-envelope-open-text text-amber-500"></i>
                            {t.confirmRsvpTitle || "Confirm Your Reunion RSVP"}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">Official Evite RSVP Form for Mandujano Family Members</p>
                    </div>

                    <form onSubmit={submitRSVP} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                {t.yourFullNameLabel || "Your Full Name"}
                            </label>
                            <input 
                                type="text" 
                                required
                                value={rsvpName}
                                onChange={(e) => setRsvpName(e.target.value)}
                                placeholder="e.g. Oscar Alfredo Matute"
                                className="w-full text-xs p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                {t.familyBranchLabel || "Family Branch"}
                            </label>
                            <select 
                                value={rsvpBranch}
                                onChange={(e) => setRsvpBranch(e.target.value)}
                                className="w-full text-xs p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-slate-50 font-medium"
                            >
                                {allSiblings.map(s => (
                                    <option key={s.id} value={`Branch #${s.order}: ${s.name}`}>
                                        Branch #{s.order}: {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1.5">
                                {t.attendanceStatusLabel || "Attendance Status"}
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setRsvpStatus('Attending')}
                                    className={`py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                                        rsvpStatus === 'Attending'
                                            ? 'bg-emerald-600 text-white border-emerald-600 shadow'
                                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    <i className="fa-solid fa-circle-check"></i> Attending
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRsvpStatus('Regrets')}
                                    className={`py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                                        rsvpStatus === 'Regrets'
                                            ? 'bg-rose-600 text-white border-rose-600 shadow'
                                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    <i className="fa-solid fa-circle-xmark"></i> Regrets
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRsvpStatus('Undecided')}
                                    className={`py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 border ${
                                        rsvpStatus === 'Undecided'
                                            ? 'bg-amber-500 text-slate-900 border-amber-500 shadow'
                                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                    }`}
                                >
                                    <i className="fa-solid fa-circle-question"></i> Undecided
                                </button>
                            </div>
                        </div>

                        {rsvpStatus === 'Attending' && (
                            <div className="grid grid-cols-2 gap-3 bg-emerald-50/60 p-4 rounded-2xl border border-emerald-200">
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                                        {t.adultsWord || "Adults"} (15+)
                                    </label>
                                    <input 
                                        type="number" 
                                        min="1" 
                                        max="20" 
                                        value={rsvpAdults}
                                        onChange={(e) => setRsvpAdults(e.target.value)}
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-bold"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">
                                        {t.kidsWord || "Children"} (0-14)
                                    </label>
                                    <input 
                                        type="number" 
                                        min="0" 
                                        max="20" 
                                        value={rsvpChildren}
                                        onChange={(e) => setRsvpChildren(e.target.value)}
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none bg-white font-bold"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                {t.specialNotesLabel || "Special Notes / Dietary Requirements"}
                            </label>
                            <textarea 
                                rows="2"
                                value={rsvpNotes}
                                onChange={(e) => setRsvpNotes(e.target.value)}
                                placeholder="e.g. Arriving on Dec 30 afternoon, vegetarian meals needed..."
                                className="w-full text-xs p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                            ></textarea>
                        </div>

                        <button 
                            type="submit"
                            className="w-full bg-gradient-to-r from-tropical-600 to-tropical-500 hover:from-tropical-700 hover:to-tropical-600 text-white font-bold py-3.5 rounded-xl shadow-md transition text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                        >
                            <i className="fa-solid fa-paper-plane"></i> {t.submitRsvpBtn || "Submit RSVP Response"}
                        </button>
                    </form>
                </div>

                <div className="lg:col-span-6 space-y-6">
                    <div className="bg-white rounded-3xl p-6 shadow-md border border-slate-200 flex items-center justify-between">
                        <div>
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                {t.confirmedAttendingLabel || "Confirmed Attending"}
                            </span>
                            <h4 className="text-3xl font-extrabold text-emerald-600 font-serif-title">
                                {totalAttendingGuests} {t.guestsWord || "Guests"}
                            </h4>
                        </div>
                        <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-bold">
                            <i className="fa-solid fa-users"></i>
                        </div>
                    </div>

                    <div className="bg-white rounded-3xl p-6 shadow-md border border-slate-200">
                        <h3 className="text-lg font-bold font-serif-title text-slate-900 border-b border-slate-100 pb-3 flex items-center justify-between">
                            <span>{t.confirmedResponsesTitle || "Confirmed Responses"}</span>
                            <span className="text-xs font-sans font-semibold text-slate-400">{rsvps.length} {t.totalWord || "Total"}</span>
                        </h3>

                        <div className="mt-4 space-y-3 max-h-[380px] overflow-y-auto custom-scrollbar">
                            {rsvps.map((rsvp) => (
                                <div key={rsvp.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h5 className="font-bold text-slate-900 text-sm">{rsvp.name}</h5>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                                rsvp.status === 'Attending' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                                                rsvp.status === 'Regrets' ? 'bg-rose-100 text-rose-800 border-rose-200' :
                                                'bg-amber-100 text-amber-800 border-amber-200'
                                            }`}>
                                                {rsvp.status}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 font-medium mt-0.5">{rsvp.branch}</p>
                                        {rsvp.notes && <p className="text-xs text-slate-600 italic mt-1">"{rsvp.notes}"</p>}
                                    </div>
                                    {rsvp.status === 'Attending' && (
                                        <div className="text-right shrink-0">
                                            <span className="text-xs font-bold text-slate-700 block">{rsvp.adults} {t.adultsWord || "Adults"}</span>
                                            {rsvp.children > 0 && <span className="text-[11px] text-amber-700 font-semibold block">{rsvp.children} {t.kidsWord || "Kids"}</span>}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* GUESTBOOK SECTION */}
            <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-md border border-slate-200 space-y-8">
                <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">
                            {t.familyGreetingsTag || "Family Greetings"}
                        </span>
                        <h3 className="text-2xl font-bold font-serif-title text-slate-900">
                            {t.guestbookTitle || "Guestbook & Blessings Board"}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                            {t.guestbookDesc || "Post your heartfelt messages, memories, and blessings for Abuela Olga and the family."}
                        </p>
                    </div>
                </div>

                <form onSubmit={submitMessage} className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
                    <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <i className="fa-solid fa-pen text-tropical-600"></i>
                        {t.writeGreetingHeading || "Write a Blessing or Greeting"}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input 
                            type="text" 
                            required
                            value={msgAuthor}
                            onChange={(e) => setMsgAuthor(e.target.value)}
                            placeholder={t.yourNamePlaceholder || "Your Name (e.g. Liliana Mandujano)"}
                            className="text-xs p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-white"
                        />
                        <select 
                            value={msgBranch}
                            onChange={(e) => setMsgBranch(e.target.value)}
                            className="text-xs p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-white font-medium"
                        >
                            {allSiblings.map(s => (
                                <option key={s.id} value={`Branch #${s.order}`}>Branch #{s.order}: {s.name}</option>
                            ))}
                        </select>
                    </div>
                    <textarea 
                        rows="3"
                        required
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        placeholder={t.writeMessagePlaceholder || "Write your message or greeting here..."}
                        className="w-full text-xs p-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-white"
                    ></textarea>
                    <div className="flex justify-end">
                        <button 
                            type="submit"
                            className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 py-2.5 rounded-xl text-xs shadow transition flex items-center gap-2"
                        >
                            <i className="fa-solid fa-comment-dots"></i>
                            {t.postGreetingBtn || "Post Greeting"}
                        </button>
                    </div>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {messages.map((msg) => (
                        <div key={msg.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full border border-amber-200">
                                        {msg.branch}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium">{msg.timestamp}</span>
                                </div>
                                <p className="text-xs text-slate-700 italic leading-relaxed my-2">
                                    "{msg.text}"
                                </p>
                            </div>
                            <div className="pt-3 border-t border-slate-200/60 flex items-center justify-between mt-3">
                                <span className="text-xs font-bold text-slate-900">— {msg.author}</span>
                                <button 
                                    onClick={() => onLikeMessage(msg.id)}
                                    className="text-xs text-rose-500 hover:text-rose-600 font-semibold flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 px-2.5 py-1 rounded-full transition border border-rose-200"
                                >
                                    <i className="fa-solid fa-heart"></i>
                                    <span>{msg.likes || 0}</span>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// --- MEMORY LANE VIEW WITH MULTI-UPLOAD, ALBUMS, LIGHTBOX & INLINE EDITING ---
function MemoryLaneView({ memories, onAddMemory, onDeleteMemory, onSetCover, onUpdateMemory, t }) {
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedAlbum, setSelectedAlbum] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [previewPhoto, setPreviewPhoto] = useState(null);

    // Edit Photo State
    const [editingPhoto, setEditingPhoto] = useState(null);
    const [editTitle, setEditTitle] = useState('');
    const [editYear, setEditYear] = useState('');
    const [editCaption, setEditCaption] = useState('');
    const [editSubmittedBy, setEditSubmittedBy] = useState('');

    // Upload Form State
    const [memTitle, setMemTitle] = useState('');
    const [memYear, setMemYear] = useState('2010');
    const [memCategory, setMemCategory] = useState('Reunions');
    const [memAlbumName, setMemAlbumName] = useState('2010 - Third Reunion');
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [memCaption, setMemCaption] = useState('');
    const [memSubmittedBy, setMemSubmittedBy] = useState('');

    const REUNION_ALBUMS = [
        '2002 - First Reunion (Telamar)',
        '2006 - Second Reunion',
        '2010 - Third Reunion',
        '2014 - Fourth Reunion',
        '2018 - Fifth Reunion',
        'Other Past Gatherings'
    ];

    const openEditModal = (photoItem) => {
        setEditingPhoto(photoItem);
        setEditTitle(photoItem.title || '');
        setEditYear(photoItem.year || '');
        setEditCaption(photoItem.caption || '');
        setEditSubmittedBy(photoItem.submittedBy || '');
    };

    const savePhotoEdit = (e) => {
        e.preventDefault();
        if (!editingPhoto) return;

        const updatedFields = {
            title: editTitle.trim() || 'Untitled Photo',
            year: editYear.trim() || 'Vintage',
            caption: editCaption.trim(),
            submittedBy: editSubmittedBy.trim() || 'Family Member'
        };

        onUpdateMemory(editingPhoto.id, updatedFields);

        if (previewPhoto && previewPhoto.id === editingPhoto.id) {
            setPreviewPhoto(prev => ({ ...prev, ...updatedFields }));
        }

        setEditingPhoto(null);
    };

    const handleFileSelection = (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        const newEntries = files.map(file => ({
            file,
            previewUrl: URL.createObjectURL(file),
            name: file.name
        }));

        setSelectedFiles(prev => [...prev, ...newEntries]);
    };

    const removeSelectedFile = (indexToRemove) => {
        setSelectedFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
    };

    const submitBatchMemories = async (e) => {
        e.preventDefault();
        if (selectedFiles.length === 0) {
            alert('Please select at least one photo.');
            return;
        }

        setUploading(true);
        setUploadProgress(0);

        try {
            const uploadedMemories = [];
            const total = selectedFiles.length;

            for (let i = 0; i < total; i++) {
                const item = selectedFiles[i];
                let finalUrl = item.previewUrl;

                if (window.storage) {
                    try {
                        const storageRef = window.storage.ref(`memories/${Date.now()}_${i}_${item.file.name}`);
                        const snap = await storageRef.put(item.file);
                        finalUrl = await snap.ref.getDownloadURL();
                    } catch (storageErr) {
                        console.warn("Storage upload failed for item, using base64:", storageErr);
                        finalUrl = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = (ev) => resolve(ev.target.result);
                            reader.readAsDataURL(item.file);
                        });
                    }
                } else {
                    finalUrl = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve(ev.target.result);
                        reader.readAsDataURL(item.file);
                    });
                }

                const displayTitle = total === 1 
                    ? (memTitle.trim() || item.name.replace(/\.[^/.]+$/, ''))
                    : (memTitle.trim() ? `${memTitle.trim()} (${i + 1}/${total})` : item.name.replace(/\.[^/.]+$/, ''));

                uploadedMemories.push({
                    title: displayTitle,
                    year: memYear,
                    category: memCategory,
                    album: memCategory === 'Reunions' ? (memAlbumName || '2010 - Third Reunion') : null,
                    photo: finalUrl,
                    caption: memCaption,
                    submittedBy: memSubmittedBy || 'Family Member'
                });

                setUploadProgress(Math.round(((i + 1) / total) * 100));
            }

            await onAddMemory(uploadedMemories);

            setSelectedFiles([]);
            setMemTitle('');
            setMemCaption('');
            setMemSubmittedBy('');
            setUploading(false);
            setUploadProgress(0);
            setShowUploadModal(false);

        } catch (err) {
            console.error("Batch upload failed:", err);
            setUploading(false);
            alert("Error during batch upload.");
        }
    };

    const sortedReunionAlbums = useMemo(() => {
        const map = {};
        memories.filter(m => m.category === 'Reunions').forEach(item => {
            const albumKey = item.album || `${item.year || '2002'} Reunion`;
            if (!map[albumKey]) {
                const match = albumKey.match(/\b(19\d\d|20\d\d)\b/);
                const extractedYear = match ? parseInt(match[0], 10) : parseInt(item.year || '2002', 10);

                map[albumKey] = {
                    name: albumKey,
                    year: item.year || (match ? match[0] : '2002'),
                    numericYear: extractedYear,
                    coverPhoto: item.photo,
                    items: []
                };
            }
            map[albumKey].items.push(item);
        });

        Object.values(map).forEach(album => {
            const explicitCover = album.items.find(item => item.isCover);
            if (explicitCover) {
                album.coverPhoto = explicitCover.photo;
            } else if (album.items.length > 0) {
                album.coverPhoto = album.items[0].photo;
            }
        });

        return Object.values(map).sort((a, b) => a.numericYear - b.numericYear);
    }, [memories]);

    return (
        <div className="space-y-8">
            {/* HERO HEADER */}
            <div className="bg-gradient-to-r from-slate-900 via-caribbean-dark to-tropical-950 text-white rounded-3xl p-8 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
                <div>
                    <span className="px-3 py-1 bg-pink-500/20 text-pink-300 border border-pink-500/30 text-xs font-bold rounded-full uppercase tracking-wider">
                        {t.memoryTag || "VINTAGE FAMILY ARCHIVE"}
                    </span>
                    <h2 className="text-2xl sm:text-4xl font-extrabold font-serif-title mt-2">
                        {t.memoryTitle || "Memory Lane Photo Gallery"}
                    </h2>
                    <p className="text-tropical-200 text-sm mt-2 max-w-xl">
                        {t.memoryDesc || "Relive precious moments, historic reunions, and cherished vintage photographs of the Mandujano family."}
                    </p>
                </div>
                <button 
                    onClick={() => {
                        if (selectedAlbum) {
                            setMemCategory('Reunions');
                            setMemAlbumName(selectedAlbum);
                            const yearMatch = selectedAlbum.match(/\b(19\d\d|20\d\d)\b/);
                            if (yearMatch) setMemYear(yearMatch[0]);
                        } else if (selectedCategory === 'Vintage' || selectedCategory === 'Milestones') {
                            setMemCategory(selectedCategory);
                        }
                        setSelectedFiles([]);
                        setShowUploadModal(true);
                    }}
                    className="shrink-0 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 font-bold px-5 py-3 rounded-2xl shadow-lg transition text-xs uppercase tracking-wider flex items-center gap-2"
                >
                    <i className="fa-solid fa-cloud-arrow-up"></i> {selectedAlbum ? `Upload Photos to ${selectedAlbum}` : (t.addMemoryBtn || "Upload Photos")}
                </button>
            </div>

            {/* CATEGORY TABS */}
            <div className="flex items-center space-x-2 overflow-x-auto pb-2">
                {['All', 'Reunions', 'Vintage', 'Milestones'].map(cat => (
                    <button
                        key={cat}
                        onClick={() => {
                            setSelectedCategory(cat);
                            setSelectedAlbum(null);
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                            selectedCategory === cat
                                ? 'bg-tropical-600 text-white shadow'
                                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                        {cat === 'All' ? (t.allPhotos || 'All Photos') : `${cat} ${cat === 'Reunions' ? 'Albums' : 'Photos'}`}
                    </button>
                ))}
            </div>

            {/* VIEW A: REUNIONS FOLDERS VIEW */}
            {selectedCategory === 'Reunions' && !selectedAlbum && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-bold font-serif-title text-slate-900 flex items-center gap-2">
                            <i className="fa-solid fa-folder-open text-amber-500"></i>
                            Reunion Photo Albums
                        </h3>
                        <span className="text-xs text-slate-500">{sortedReunionAlbums.length} Albums Recorded</span>
                    </div>

                    {sortedReunionAlbums.length === 0 ? (
                        <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                            <i className="fa-solid fa-folder-plus text-4xl text-slate-300 mb-2"></i>
                            <p className="text-slate-600 font-semibold text-sm">No reunion albums created yet.</p>
                            <p className="text-xs text-slate-400 mt-1">Click 'Upload Photos' above to batch drop pictures into your first album!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                            {sortedReunionAlbums.map(album => (
                                <div 
                                    key={album.name}
                                    onClick={() => setSelectedAlbum(album.name)}
                                    className="bg-white border-2 border-slate-200 hover:border-tropical-500 rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all cursor-pointer group flex flex-col justify-between"
                                >
                                    <div className="relative h-56 bg-slate-800 overflow-hidden">
                                        <img 
                                            src={album.coverPhoto} 
                                            alt={album.name} 
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100" 
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent"></div>
                                        
                                        <div className="absolute top-3 left-3 bg-amber-400 text-slate-900 text-xs font-bold px-3 py-1 rounded-full shadow">
                                            <i className="fa-solid fa-folder mr-1.5"></i> Album
                                        </div>

                                        <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur text-white text-[11px] font-bold px-2.5 py-1 rounded-full border border-white/20">
                                            <i className="fa-solid fa-images mr-1"></i> {album.items.length} {album.items.length === 1 ? 'Photo' : 'Photos'}
                                        </div>

                                        <div className="absolute bottom-3 left-4 right-4">
                                            <h4 className="font-bold text-white text-lg font-serif-title leading-snug drop-shadow">
                                                {album.name}
                                            </h4>
                                            <span className="text-xs text-tropical-200">Year {album.year}</span>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-slate-50 flex items-center justify-between text-xs font-bold text-tropical-700 group-hover:text-tropical-900 border-t border-slate-200">
                                        <span>Open Reunion Album &rarr;</span>
                                        <i className="fa-solid fa-arrow-right text-[10px] transform group-hover:translate-x-1 transition-transform"></i>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* VIEW B: INSIDE A SPECIFIC REUNION ALBUM */}
            {selectedCategory === 'Reunions' && selectedAlbum && (
                <div className="space-y-6">
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center space-x-3">
                            <button 
                                onClick={() => setSelectedAlbum(null)}
                                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                            >
                                <i className="fa-solid fa-arrow-left"></i> All Albums
                            </button>
                            <div>
                                <h3 className="text-xl font-bold font-serif-title text-slate-900">{selectedAlbum}</h3>
                                <p className="text-xs text-slate-500">
                                    {sortedReunionAlbums.find(a => a.name === selectedAlbum)?.items.length || 0} photos saved in this album
                                </p>
                            </div>
                        </div>

                        <button 
                            onClick={() => {
                                setMemCategory('Reunions');
                                setMemAlbumName(selectedAlbum);
                                const yearMatch = selectedAlbum.match(/\b(19\d\d|20\d\d)\b/);
                                if (yearMatch) setMemYear(yearMatch[0]);
                                setSelectedFiles([]);
                                setShowUploadModal(true);
                            }}
                            className="bg-tropical-600 hover:bg-tropical-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition shadow flex items-center gap-1.5"
                        >
                            <i className="fa-solid fa-cloud-arrow-up"></i> Upload Photos in Masse
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {(sortedReunionAlbums.find(a => a.name === selectedAlbum)?.items || []).map(item => (
                            <div 
                                key={item.id} 
                                onClick={() => setPreviewPhoto(item)}
                                className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all card-glow flex flex-col cursor-pointer relative group"
                            >
                                <div className="relative h-64 bg-slate-100 overflow-hidden">
                                    <img 
                                        src={item.photo} 
                                        alt={item.title} 
                                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" 
                                    />
                                    <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur text-amber-300 text-xs font-bold px-3 py-1 rounded-full border border-amber-400/30">
                                        <i className="fa-regular fa-calendar-check mr-1"></i> {item.year}
                                    </div>
                                    
                                    {/* Action Buttons: Edit, Set Cover & Delete */}
                                    <div className="absolute top-3 right-3 flex items-center space-x-1.5">
                                        <button
                                            type="button"
                                            title="Edit caption & details"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openEditModal(item);
                                            }}
                                            className="w-8 h-8 rounded-full bg-slate-900/80 hover:bg-tropical-600 text-slate-300 hover:text-white border border-white/20 flex items-center justify-center transition shadow"
                                        >
                                            <i className="fa-solid fa-pen text-xs"></i>
                                        </button>
                                        <button
                                            type="button"
                                            title={item.isCover ? "Current Album Cover" : "Set as Album Cover"}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onSetCover && onSetCover(selectedAlbum, item.id);
                                            }}
                                            className={`w-8 h-8 rounded-full border border-white/20 flex items-center justify-center transition shadow ${
                                                item.isCover 
                                                    ? 'bg-amber-400 text-slate-900 font-bold' 
                                                    : 'bg-slate-900/80 hover:bg-amber-400 hover:text-slate-900 text-slate-300'
                                            }`}
                                        >
                                            <i className="fa-solid fa-star text-xs"></i>
                                        </button>
                                        <button
                                            type="button"
                                            title="Delete photo"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteMemory(item.id);
                                            }}
                                            className="w-8 h-8 rounded-full bg-slate-900/80 hover:bg-rose-600 text-slate-300 hover:text-white border border-white/20 flex items-center justify-center transition shadow"
                                        >
                                            <i className="fa-solid fa-trash text-xs"></i>
                                        </button>
                                    </div>
                                </div>
                                <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                                    <div>
                                        <h4 className="font-bold text-slate-900 text-base font-serif-title">{item.title}</h4>
                                        {item.caption && <p className="text-xs text-slate-600 italic mt-1 leading-relaxed">"{item.caption}"</p>}
                                    </div>
                                    <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                                        <span>By: <strong className="text-slate-700">{item.submittedBy}</strong></span>
                                        <i className="fa-solid fa-magnifying-glass-plus text-slate-400 hover:text-tropical-600"></i>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* VIEW C: FLAT GRID FOR ALL / VINTAGE / MILESTONES */}
            {selectedCategory !== 'Reunions' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {memories
                        .filter(m => selectedCategory === 'All' || m.category === selectedCategory)
                        .map(item => (
                            <div 
                                key={item.id} 
                                onClick={() => setPreviewPhoto(item)}
                                className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all card-glow flex flex-col cursor-pointer relative group"
                            >
                                <div className="relative h-64 bg-slate-100 overflow-hidden">
                                    <img 
                                        src={item.photo} 
                                        alt={item.title} 
                                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" 
                                    />
                                    <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur text-amber-300 text-xs font-bold px-3 py-1 rounded-full border border-amber-400/30">
                                        <i className="fa-regular fa-calendar-check mr-1"></i> {item.year}
                                    </div>
                                    <div className="absolute top-3 right-20 bg-tropical-600/90 backdrop-blur text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                        {item.category}
                                    </div>
                                    
                                    {/* Action Buttons: Edit & Delete */}
                                    <div className="absolute top-3 right-3 flex items-center space-x-1.5">
                                        <button
                                            type="button"
                                            title="Edit caption & details"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openEditModal(item);
                                            }}
                                            className="w-8 h-8 rounded-full bg-slate-900/80 hover:bg-tropical-600 text-slate-300 hover:text-white border border-white/20 flex items-center justify-center transition shadow"
                                        >
                                            <i className="fa-solid fa-pen text-xs"></i>
                                        </button>
                                        <button
                                            type="button"
                                            title="Delete photo"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteMemory(item.id);
                                            }}
                                            className="w-8 h-8 rounded-full bg-slate-900/80 hover:bg-rose-600 text-slate-300 hover:text-white border border-white/20 flex items-center justify-center transition shadow"
                                        >
                                            <i className="fa-solid fa-trash text-xs"></i>
                                        </button>
                                    </div>
                                </div>
                                <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                                    <div>
                                        <h4 className="font-bold text-slate-900 text-base font-serif-title">{item.title}</h4>
                                        {item.caption && <p className="text-xs text-slate-600 italic mt-1 leading-relaxed">"{item.caption}"</p>}
                                    </div>
                                    <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-400 flex items-center justify-between">
                                        <span>By: <strong className="text-slate-700">{item.submittedBy}</strong></span>
                                        <i className="fa-solid fa-magnifying-glass-plus text-slate-400 hover:text-tropical-600"></i>
                                    </div>
                                </div>
                            </div>
                        ))}
                </div>
            )}

            {/* LIGHTBOX MODAL WITH FULL EDIT BUTTON */}
            {previewPhoto && (
                <div 
                    className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4"
                    onClick={() => setPreviewPhoto(null)}
                >
                    <div 
                        className="max-w-3xl w-full bg-slate-900 text-white rounded-3xl overflow-hidden shadow-2xl border border-slate-800"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="relative max-h-[70vh] bg-black flex items-center justify-center">
                            <img src={previewPhoto.photo} alt={previewPhoto.title} className="max-h-[70vh] w-auto object-contain" />
                            <div className="absolute top-4 right-4 flex items-center space-x-2">
                                <button 
                                    title="Edit caption & story"
                                    onClick={() => openEditModal(previewPhoto)}
                                    className="bg-tropical-600/90 hover:bg-tropical-700 text-white w-9 h-9 rounded-full flex items-center justify-center transition border border-white/20 shadow"
                                >
                                    <i className="fa-solid fa-pen text-xs"></i>
                                </button>
                                <button 
                                    title="Delete photo"
                                    onClick={() => {
                                        onDeleteMemory(previewPhoto.id);
                                        setPreviewPhoto(null);
                                    }}
                                    className="bg-rose-600/90 hover:bg-rose-700 text-white w-9 h-9 rounded-full flex items-center justify-center transition border border-white/20 shadow"
                                >
                                    <i className="fa-solid fa-trash text-xs"></i>
                                </button>
                                <button 
                                    onClick={() => setPreviewPhoto(null)}
                                    className="bg-slate-900/80 hover:bg-slate-800 text-white w-9 h-9 rounded-full flex items-center justify-center border border-white/20 shadow"
                                >
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>
                        <div className="p-6 space-y-2">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xl font-bold font-serif-title text-white">{previewPhoto.title}</h3>
                                <span className="text-xs bg-amber-400 text-slate-900 font-bold px-2.5 py-0.5 rounded-full">{previewPhoto.year}</span>
                            </div>
                            {previewPhoto.caption ? (
                                <p className="text-sm text-slate-300 italic leading-relaxed whitespace-pre-line">{previewPhoto.caption}</p>
                            ) : (
                                <p className="text-xs text-slate-500 italic">No caption added yet. Click the pencil icon above to write who is in this photo!</p>
                            )}
                            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                                <span>Submitted by: <strong className="text-slate-200">{previewPhoto.submittedBy}</strong></span>
                                <button 
                                    onClick={() => openEditModal(previewPhoto)}
                                    className="text-amber-400 hover:text-amber-300 font-semibold underline flex items-center gap-1"
                                >
                                    <i className="fa-solid fa-pen"></i> Edit Caption
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* EDIT PHOTO DETAILS MODAL */}
            {editingPhoto && (
                <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-150">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                            <h3 className="text-lg font-bold text-slate-900 font-serif-title flex items-center gap-2">
                                <i className="fa-solid fa-pen-to-square text-tropical-600"></i> Edit Photo Information
                            </h3>
                            <button 
                                onClick={() => setEditingPhoto(null)}
                                className="text-slate-400 hover:text-slate-600 text-lg"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <form onSubmit={savePhotoEdit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Photo Title</label>
                                <input 
                                    type="text" 
                                    required
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    placeholder="e.g. Carlos and Siblings at Family Dinner"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Year</label>
                                    <input 
                                        type="text" 
                                        required
                                        value={editYear}
                                        onChange={(e) => setEditYear(e.target.value)}
                                        placeholder="e.g. 1982"
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Contributor</label>
                                    <input 
                                        type="text" 
                                        value={editSubmittedBy}
                                        onChange={(e) => setEditSubmittedBy(e.target.value)}
                                        placeholder="e.g. Celeo Mandujano"
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                    Caption & People in Photo
                                </label>
                                <textarea 
                                    rows="4"
                                    value={editCaption}
                                    onChange={(e) => setEditCaption(e.target.value)}
                                    placeholder="Add names of people from left to right, location, or the story behind this photo..."
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                ></textarea>
                            </div>

                            <div className="flex justify-end space-x-2 pt-2">
                                <button 
                                    type="button"
                                    onClick={() => setEditingPhoto(null)}
                                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit"
                                    className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-tropical-600 hover:bg-tropical-700 shadow"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* BATCH UPLOAD MODAL */}
            {showUploadModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                            <h3 className="text-lg font-bold text-slate-900 font-serif-title flex items-center gap-2">
                                <i className="fa-solid fa-images text-pink-500"></i> Batch Upload Photos
                            </h3>
                            <button 
                                disabled={uploading}
                                onClick={() => setShowUploadModal(false)}
                                className="text-slate-400 hover:text-slate-600 text-lg"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <form onSubmit={submitBatchMemories} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Category</label>
                                    <select 
                                        value={memCategory}
                                        onChange={(e) => setMemCategory(e.target.value)}
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-white font-medium"
                                    >
                                        <option value="Reunions">Reunion Album</option>
                                        <option value="Vintage">Vintage</option>
                                        <option value="Milestones">Milestones</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Year Taken</label>
                                    <input 
                                        type="text" 
                                        required
                                        value={memYear}
                                        onChange={(e) => setMemYear(e.target.value)}
                                        placeholder="e.g. 2010"
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                    />
                                </div>
                            </div>

                            {memCategory === 'Reunions' && (
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                        Reunion Album Target Folder
                                    </label>
                                    <input 
                                        type="text" 
                                        list="reunion-album-suggestions"
                                        value={memAlbumName}
                                        onChange={(e) => setMemAlbumName(e.target.value)}
                                        placeholder="e.g. 2010 - Third Reunion"
                                        className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none bg-amber-50/50 font-semibold text-slate-900"
                                    />
                                    <datalist id="reunion-album-suggestions">
                                        {REUNION_ALBUMS.map(alb => <option key={alb} value={alb} />)}
                                    </datalist>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                    Base Title (Optional)
                                </label>
                                <input 
                                    type="text" 
                                    value={memTitle}
                                    onChange={(e) => setMemTitle(e.target.value)}
                                    placeholder="e.g. La Ensenada Beach Activities"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                />
                                <p className="text-[10px] text-slate-400 mt-0.5">Leave blank to automatically use image filenames.</p>
                            </div>

                            {/* MULTI-FILE PICKER */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                    Select Images (Pick Multiple Files)
                                </label>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    multiple
                                    disabled={uploading}
                                    onChange={handleFileSelection}
                                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-tropical-50 file:text-tropical-700 hover:file:bg-tropical-100 cursor-pointer"
                                />

                                {/* THUMBNAIL QUEUE PREVIEW */}
                                {selectedFiles.length > 0 && (
                                    <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                                        <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-2">
                                            <span>{selectedFiles.length} photo(s) selected</span>
                                            <button 
                                                type="button" 
                                                onClick={() => setSelectedFiles([])}
                                                className="text-rose-600 hover:underline text-[11px]"
                                            >
                                                Clear All
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1">
                                            {selectedFiles.map((f, index) => (
                                                <div key={index} className="relative group rounded-lg overflow-hidden border border-slate-300 aspect-square bg-slate-200">
                                                    <img src={f.previewUrl} alt="queue preview" className="w-full h-full object-cover" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removeSelectedFile(index)}
                                                        className="absolute top-1 right-1 bg-rose-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] opacity-90 group-hover:opacity-100"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* UPLOAD PROGRESS BAR */}
                                {uploading && (
                                    <div className="mt-3 space-y-1">
                                        <div className="flex justify-between text-xs font-bold text-tropical-700">
                                            <span>Uploading photos...</span>
                                            <span>{uploadProgress}%</span>
                                        </div>
                                        <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                                            <div 
                                                className="bg-tropical-600 h-2 transition-all duration-300"
                                                style={{ width: `${uploadProgress}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Caption / Story Description (Applied to all)</label>
                                <textarea 
                                    rows="2"
                                    value={memCaption}
                                    onChange={(e) => setMemCaption(e.target.value)}
                                    placeholder="Shared context or story about this batch..."
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                ></textarea>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Your Name (Contributor)</label>
                                <input 
                                    type="text" 
                                    value={memSubmittedBy}
                                    onChange={(e) => setMemSubmittedBy(e.target.value)}
                                    placeholder="e.g. Celeo Mandujano"
                                    className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-tropical-500 outline-none"
                                />
                            </div>

                            <div className="flex justify-end space-x-2 pt-2">
                                <button 
                                    type="button"
                                    disabled={uploading}
                                    onClick={() => setShowUploadModal(false)}
                                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit"
                                    disabled={uploading || selectedFiles.length === 0}
                                    className={`px-5 py-2 rounded-xl text-xs font-bold text-white shadow flex items-center gap-2 ${
                                        uploading || selectedFiles.length === 0
                                            ? 'bg-slate-400 cursor-not-allowed'
                                            : 'bg-tropical-600 hover:bg-tropical-700'
                                    }`}
                                >
                                    <i className="fa-solid fa-cloud-arrow-up"></i>
                                    <span>Upload {selectedFiles.length > 0 ? `${selectedFiles.length} Photos` : 'Photos'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// --- SCHEDULE OF EVENTS VIEW ---
function ScheduleView({ t, lang }) {
    const [selectedDay, setSelectedDay] = useState('all');

    const scheduleData = useMemo(() => [
        {
            day: 'dec30',
            date: lang === 'es' ? 'Jueves, 30 de Dic, 2027' : 'Thursday, Dec 30, 2027',
            title: lang === 'es' ? 'Recepción de Bienvenida y Llegada a la Playa' : 'Welcome Reception & Beach Arrival',
            icon: 'fa-cocktail',
            badge: lang === 'es' ? 'Día 1' : 'Day 1',
            events: [
                { time: '02:00 PM – 05:00 PM', title: lang === 'es' ? 'Registro en el Resort y Entrega de Kits de Bienvenida' : 'Resort Check-In & Welcome Kit Registration', desc: lang === 'es' ? 'Recoja sus camisetas oficiales, gorras y llaves de habitación en el lobby de La Ensenada.' : 'Pick up your official family T-shirts, caps, and room keys at La Ensenada Lobby.', location: lang === 'es' ? 'Lobby Principal' : 'Main Lobby' },
                { time: '06:00 PM – 08:30 PM', title: lang === 'es' ? 'Coctel Rompehielos al Atardecer y Buffet Hondureño' : 'Sunset Icebreaker Cocktail & Honduran Buffet', desc: lang === 'es' ? 'Brindis de bienvenida por la Abuela Olga Mandujano, tambores Garífunas en vivo y buffet frente al mar.' : 'Welcome toast by Abuela Olga Mandujano, and oceanfront buffet.', location: lang === 'es' ? 'Terraza Palapa Atardecer' : 'Palapa Sunset Deck' },
                { time: '08:30 PM – 10:30 PM', title: lang === 'es' ? 'Juegos de Trivia Familiar' : 'Family Trivia & Icebreaker Games', desc: lang === 'es' ? '¡Trivia divertida conectando primos y probando conocimientos de la historia familiar Mandujano!' : 'Fun trivia matching cousins and testing knowledge of Mandujano family history!', location: lang === 'es' ? 'Pabellón de la Playa' : 'Beach Pavilion' }
            ]
        },
        {
            day: 'dec31',
            date: lang === 'es' ? 'Viernes, 31 de Dic, 2027' : 'Friday, Dec 31, 2027',
            title: lang === 'es' ? 'Cena de Gala y Celebración de Fin de Año' : 'Gala Dinner & New Year’s Eve Celebration',
            icon: 'fa-champagne-glasses',
            badge: lang === 'es' ? 'Día 2' : 'Day 2',
            events: [
                { time: '08:00 AM – 10:00 AM', title: lang === 'es' ? 'Buffet de Desayuno Tropical Familiar' : 'Family Tropical Breakfast Buffet', desc: lang === 'es' ? 'Comience el día juntos con frutas frescas, baleadas, café y jugos tropicales.' : 'Start the day together with fresh fruit, baleadas, coffee, and tropical juices.', location: lang === 'es' ? 'Restaurante Las Carabelas' : 'Las Carabelas Restaurant' },
                { time: '10:30 AM – 12:00 PM', title: lang === 'es' ? 'Sesión de Fotos Grupales por Generación' : 'Generation Group Photo Shoot', desc: lang === 'es' ? 'Fotos profesionales tomadas por generaciones (1ra, 2da, 3ra, 4ta gen). ¡Vestir de blanco y turquesa!' : 'Professional photos taken by generation wings (1st, 2nd, 3rd, 4th gen). Wear matching white/teal attire!', location: lang === 'es' ? 'Muelle del Mar' : 'Ocean Pier' },
                { time: '01:30 PM – 05:30 PM', title: lang === 'es' ? 'Abierto / Playa / Piscina' : 'Open Time / Beach / Pool', desc: lang === 'es' ? 'Diviertete en Familia!' : 'Have fun with Family!', location: lang === 'es' ? 'Gran Salón de Eventos' : 'Grand Ballroom' },
                { time: '07:30 PM – 12:00 AM', title: lang === 'es' ? 'Cena de Gala Oficial de la Reunión Mandujano' : 'Official Mandujano Reunion Gala Dinner', desc: lang === 'es' ? 'Cena formal, ceremonia de premios familiares, video tributo y brindis con champaña a medianoche.' : 'Formal dinner, family awards ceremony, video tribute, and champagne toast as the clock strikes midnight!', location: lang === 'es' ? 'Gran Salón de Eventos' : 'Grand Ballroom' }
            ]
        },
        {
            day: 'jan1',
            date: lang === 'es' ? 'Sábado, 1 de Enero, 2028' : 'Saturday, Jan 1, 2028',
            title: lang === 'es' ? 'Día de Playa de Año Nuevo y Olímpiadas Familiares' : 'New Year’s Beach Day & Family Olympics',
            icon: 'fa-volleyball',
            badge: lang === 'es' ? 'Día 3' : 'Day 3',
            events: [
                { time: '11:00 AM – 03:00 PM', title: lang === 'es' ? 'Olímpiadas Playeras Mandujano y Parque Acuático' : 'Mandujano Family Beach Olympics & Waterpark', desc: lang === 'es' ? 'Torneo de voleibol, búsqueda del tesoro para niños, juego de la cuerda y fiesta en la piscina.' : 'Volleyball tournament, kids treasure hunt, tug-of-war, and pool party.', location: lang === 'es' ? 'Frente a la Playa' : 'La Ensenada Beachfront' },
                { time: '06:00 PM – 09:00 PM', title: lang === 'es' ? 'BBQ Caribeño y Fogata con Guitarra' : 'Caribbean BBQ & Campfire Sing-Along', desc: lang === 'es' ? 'Parrillada de mariscos frescos, fogata con guitarra acústica e historias contadas por la Abuela Olga.' : 'Fresh seafood BBQ grill, acoustic guitar campfire, and storytelling by Abuela Olga.', location: lang === 'es' ? 'Área de Fogata en la Playa' : 'Beach Bonfire Area' }
            ]
        },
        {
            day: 'jan2',
            date: lang === 'es' ? 'Domingo, 2 de Enero, 2028' : 'Sunday, Jan 2, 2028',
            title: lang === 'es' ? 'Desayuno de Despedida y Bendición Final' : 'Farewell Breakfast & Closing Blessing',
            icon: 'fa-heart-circle-check',
            badge: lang === 'es' ? 'Día 4' : 'Day 4',
            events: [
                { time: '08:30 AM – 11:00 AM', title: lang === 'es' ? 'Brunch de Despedida y Bendición de la Abuela' : 'Farewell Brunch & Abuela’s Closing Blessing', desc: lang === 'es' ? 'Oración grupal de cierre, intercambio de fotos y abrazos de despedida antes del check-out.' : 'Closing group prayer, photo exchange, and farewell warm hugs before check-out.', location: lang === 'es' ? 'Comedor Principal' : 'Grand Dining Deck' }
            ]
        }
    ], [lang]);

    const filteredSchedule = useMemo(() => {
        if (selectedDay === 'all') return scheduleData;
        return scheduleData.filter(s => s.day === selectedDay);
    }, [selectedDay, scheduleData]);

    return (
        <div className="space-y-8">
            <div className="bg-gradient-to-r from-slate-900 via-tropical-900 to-caribbean-dark text-white rounded-3xl p-8 shadow-xl">
                <span className="px-3 py-1 bg-amber-400 text-slate-900 text-xs font-bold rounded-full uppercase tracking-wider">
                    {t.timelineTag || "Interactive Event Timeline"}
                </span>
                <h2 className="text-2xl sm:text-4xl font-extrabold font-serif-title mt-2">
                    {t.scheduleTitle}
                </h2>
                <p className="text-tropical-200 text-sm mt-2 max-w-2xl">
                    {t.scheduleDesc}
                </p>
            </div>

            <div className="flex items-center space-x-2 overflow-x-auto pb-2">
                <button
                    onClick={() => setSelectedDay('all')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                        selectedDay === 'all'
                            ? 'bg-tropical-600 text-white shadow'
                            : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                >
                    {t.allDaysBtn || "All Days (Dec 30 – Jan 2)"}
                </button>
                {scheduleData.map(s => (
                    <button
                        key={s.day}
                        onClick={() => setSelectedDay(s.day)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 ${
                            selectedDay === s.day
                                ? 'bg-tropical-600 text-white shadow'
                                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                        }`}
                    >
                        <i className={`fa-solid ${s.icon}`}></i>
                        <span>{s.badge}: {s.date.split(',')[1]}</span>
                    </button>
                ))}
            </div>

            <div className="space-y-8">
                {filteredSchedule.map(dayItem => (
                    <div key={dayItem.day} className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-2 mb-6">
                            <div className="flex items-center space-x-3">
                                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center text-xl font-bold">
                                    <i className={`fa-solid ${dayItem.icon}`}></i>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                                        {dayItem.badge}
                                    </span>
                                    <h3 className="text-xl font-bold font-serif-title text-slate-900 mt-0.5">{dayItem.title}</h3>
                                </div>
                            </div>
                            <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-lg self-start sm:self-auto">
                                <i className="fa-regular fa-calendar mr-1"></i> {dayItem.date}
                            </span>
                        </div>

                        <div className="space-y-4 relative border-l-2 border-tropical-200 pl-6 ml-4">
                            {dayItem.events.map((evt, idx) => (
                                <div key={idx} className="relative bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:border-tropical-400 transition">
                                    <div className="absolute -left-[31px] top-4 w-4 h-4 rounded-full bg-tropical-500 border-4 border-white shadow"></div>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
                                        <h4 className="font-bold text-slate-900 text-sm sm:text-base">{evt.title}</h4>
                                        <span className="text-xs font-bold text-tropical-700 bg-tropical-100 px-2.5 py-0.5 rounded-full self-start sm:self-auto">
                                            <i className="fa-regular fa-clock mr-1"></i> {evt.time}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-600 mb-2">{evt.desc}</p>
                                    <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                                        <i className="fa-solid fa-location-dot text-amber-500"></i>
                                        <span>Location: {evt.location}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// --- MERCH STORE VIEW ---
function MerchView({ familyData, showToast, t }) {
    const [cart, setCart] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState('Branch #1: Camilo Mandujano');

    const merchItems = [
        {
            id: 'tshirt-teal',
            name: 'Official Reunion T-Shirt (Caribbean Teal)',
            price: 20,
            icon: 'fa-shirt',
            badge: 'Bestseller',
            img: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&q=80&w=400',
            desc: '100% Premium Honduran Cotton T-Shirt with official Mandujano Crest front & Tela 2027 back print.',
            hasSizes: true,
            colors: ['Teal', 'White', 'Navy Blue', 'Gold']
        },
        {
            id: 'cap-embroidered',
            name: 'Commemorative Beach Cap / Visor',
            price: 15,
            icon: 'fa-hat-cowboy',
            badge: 'Popular',
            img: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&q=80&w=400',
            desc: 'Breathable UV-protection sun visor cap embroidered with Mandujano Family Reunion emblem.',
            hasSizes: false,
            colors: ['Teal', 'Gold', 'Navy']
        },
        {
            id: 'tote-bag',
            name: 'Reunion Canvas Beach Tote Bag',
            price: 12,
            icon: 'fa-bag-shopping',
            badge: 'Eco-Friendly',
            img: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&q=80&w=400',
            desc: 'Heavy-duty eco canvas beach bag perfect for towels, sunscreen, and reunion souvenirs.',
            hasSizes: false,
            colors: ['Natural Canvas', 'Teal']
        }
    ];

    const [itemStates, setItemStates] = useState({
        'tshirt-teal': { size: 'L', color: 'Teal', qty: 1 },
        'cap-embroidered': { color: 'Teal', qty: 1 },
        'tote-bag': { color: 'Natural Canvas', qty: 1 }
    });

    const allSiblings = useMemo(() => [...familyData.sisters, ...familyData.brothers], [familyData]);

    const updateItemState = (id, field, value) => {
        setItemStates(prev => ({
            ...prev,
            [id]: { ...prev[id], [field]: value }
        }));
    };

    const addToCart = (product) => {
        const config = itemStates[product.id];
        const cartItem = {
            cartId: `${product.id}-${Date.now()}`,
            id: product.id,
            name: product.name,
            price: product.price,
            size: config.size || 'N/A',
            color: config.color || 'Standard',
            qty: parseInt(config.qty) || 1,
            total: product.price * (parseInt(config.qty) || 1)
        };

        setCart(prev => [...prev, cartItem]);
        showToast(`Added ${cartItem.qty}x ${product.name} to order!`, 'success');
    };

    const removeFromCart = (cartId) => {
        setCart(prev => prev.filter(item => item.cartId !== cartId));
    };

    const grandTotal = useMemo(() => cart.reduce((acc, curr) => acc + curr.total, 0), [cart]);

    const submitOrder = (e) => {
        e.preventDefault();
        if (cart.length === 0) {
            alert('Your cart is empty! Please add items to your order first.');
            return;
        }
        alert(`Pre-order submitted successfully for ${selectedBranch}! Total: $${grandTotal} USD. Your order will be ready at registration.`);
        setCart([]);
    };

    return (
        <div className="space-y-8">
            <div className="bg-gradient-to-r from-caribbean-dark via-tropical-900 to-slate-900 text-white rounded-3xl p-8 shadow-xl">
                <span className="px-3 py-1 bg-amber-400 text-slate-900 text-xs font-bold rounded-full uppercase tracking-wider">
                    {t.merchShopTag || "Official Reunion Shop"}
                </span>
                <h2 className="text-2xl sm:text-4xl font-extrabold font-serif-title mt-2">
                    {t.merchTitle}
                </h2>
                <p className="text-tropical-200 text-sm mt-2 max-w-2xl">
                    {t.merchDesc}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {merchItems.map(item => {
                            const state = itemStates[item.id];
                            return (
                                <div key={item.id} className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between">
                                    <div>
                                        <div className="relative h-48 bg-slate-100 overflow-hidden">
                                            <img src={item.img} alt={item.name} className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
                                            <span className="absolute top-3 left-3 bg-amber-400 text-slate-900 font-bold text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                                {item.badge}
                                            </span>
                                            <span className="absolute top-3 right-3 bg-slate-900/90 text-white font-serif-title font-bold text-sm px-3 py-1 rounded-full border border-amber-300">
                                                ${item.price} USD
                                            </span>
                                        </div>
                                        <div className="p-5 space-y-3">
                                            <h3 className="font-bold text-slate-900 text-base">{item.name}</h3>
                                            <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>

                                            <div className="space-y-2 pt-2 border-t border-slate-100">
                                                {item.hasSizes && (
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                                            {t.selectSizeLabel || "Select Size"}
                                                        </label>
                                                        <div className="flex gap-1.5 flex-wrap">
                                                            {['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'].map(sz => (
                                                                <button
                                                                    key={sz}
                                                                    type="button"
                                                                    onClick={() => updateItemState(item.id, 'size', sz)}
                                                                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition ${
                                                                        state.size === sz
                                                                            ? 'bg-tropical-600 text-white border-tropical-600'
                                                                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                                                                    }`}
                                                                >
                                                                    {sz}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                                            {t.colorLabel || "Color"}
                                                        </label>
                                                        <select 
                                                            value={state.color}
                                                            onChange={(e) => updateItemState(item.id, 'color', e.target.value)}
                                                            className="w-full text-xs p-2 rounded-xl border border-slate-300 outline-none bg-slate-50 font-medium"
                                                        >
                                                            {item.colors.map(c => <option key={c} value={c}>{c}</option>)}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-700 uppercase mb-1">
                                                            {t.quantityLabel || "Quantity"}
                                                        </label>
                                                        <input 
                                                            type="number" 
                                                            min="1" 
                                                            max="20" 
                                                            value={state.qty}
                                                            onChange={(e) => updateItemState(item.id, 'qty', e.target.value)}
                                                            className="w-full text-xs p-2 rounded-xl border border-slate-300 outline-none font-bold"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-5 pt-0">
                                        <button 
                                            type="button"
                                            onClick={() => addToCart(item)}
                                            className="w-full bg-tropical-600 hover:bg-tropical-700 text-white font-bold py-2.5 rounded-xl shadow transition text-xs flex items-center justify-center gap-2"
                                        >
                                            <i className="fa-solid fa-cart-plus"></i> {t.addToOrder}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="lg:col-span-4 bg-white rounded-3xl p-6 shadow-md border border-slate-200 flex flex-col justify-between">
                    <div>
                        <h3 className="text-lg font-bold font-serif-title text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
                            <i className="fa-solid fa-cart-shopping text-amber-500"></i>
                            {t.orderSummary}
                        </h3>

                        <div className="mt-4 mb-3">
                            <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                                {t.branchOrderingForLabel || "Branch Ordering For"}
                            </label>
                            <select 
                                value={selectedBranch}
                                onChange={(e) => setSelectedBranch(e.target.value)}
                                className="w-full text-xs p-2.5 rounded-xl border border-slate-300 bg-slate-50 font-medium outline-none"
                            >
                                {allSiblings.map(s => (
                                    <option key={s.id} value={`Branch #${s.order}: ${s.name}`}>
                                        Branch #{s.order}: {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {cart.length === 0 ? (
                            <div className="text-center py-10 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 my-4">
                                <i className="fa-solid fa-basket-shopping text-3xl text-slate-300 mb-2"></i>
                                <p className="text-xs text-slate-500 font-medium">
                                    {t.cartEmptyMsg || "Your pre-order cart is empty."}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3 my-4 max-h-[300px] overflow-y-auto custom-scrollbar">
                                {cart.map(item => (
                                    <div key={item.cartId} className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center justify-between gap-2">
                                        <div>
                                            <p className="text-xs font-bold text-slate-900 line-clamp-1">{item.name}</p>
                                            <p className="text-[10px] text-slate-500 font-medium">
                                                {item.qty}x • Size: {item.size} • {item.color}
                                            </p>
                                        </div>
                                        <div className="flex items-center space-x-2 shrink-0">
                                            <span className="text-xs font-bold text-slate-900">${item.total}</span>
                                            <button 
                                                onClick={() => removeFromCart(item.cartId)}
                                                className="text-slate-400 hover:text-rose-600 transition"
                                            >
                                                <i className="fa-solid fa-trash text-xs"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-slate-100 pt-4 space-y-4">
                        <div className="flex justify-between items-center text-base font-extrabold">
                            <span className="text-slate-700">{t.total}:</span>
                            <span className="text-xl font-serif-title text-amber-600">${grandTotal} USD</span>
                        </div>

                        <button 
                            onClick={submitOrder}
                            disabled={cart.length === 0}
                            className={`w-full font-bold py-3.5 rounded-xl shadow transition text-xs uppercase tracking-wider flex items-center justify-center gap-2 ${
                                cart.length > 0
                                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-900'
                                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                        >
                            <i className="fa-solid fa-check-circle"></i> {t.placeOrder}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Render application
const ReactDOMObj = window.ReactDOM || ReactDOM;
const root = ReactDOMObj.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
