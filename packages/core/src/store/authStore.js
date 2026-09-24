import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// packages/core ya no tiene un lib/config.js propio con la cooperativa fija
// -- este store deja de importar COOPERATIVE/COOPERATIVE_ID a nivel de
// módulo (no puede: cuál cooperativa es se define en cada app, no en core).
// En vez de eso guarda `cooperative` como parte del estado, seteado UNA vez
// por cada app en su bootstrap (fuera de React, vía
// `useAuthStore.getState().setCooperative(COOPERATIVE)`, antes de llamar a
// init()/signIn()) -- pendiente de conectar en la Fase 3 (App.jsx de cada
// app). Así ningún consumidor de useAuthStore (Layout.jsx, páginas, etc.)
// tiene que cambiar su import ni su forma de llamarlo.
export const useAuthStore = create((set, get) => ({
  session: null,
  webUser: null,
  loading: true,
  cooperative: null,

  setCooperative: (cooperative) => set({ cooperative }),

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { set({ loading: false }); return }

    const { data: wu, error } = await supabase
      .from('web_users')
      .select('id, username, first_name, last_name, role, cooperative_id')
      .eq('auth_user_id', session.user.id)
      .eq('is_active', true)
      .single()

    // PGRST116 = "no rows" (single() sin match) -- es el caso esperado
    // cuando el usuario fue desactivado o borrado. Cualquier otro error
    // (red, permisos, etc) se loguea para no perder la causa real detrás
    // de lo que al usuario le aparece como un logout silencioso.
    if (error && error.code !== 'PGRST116') {
      console.error('authStore.init: error al cargar web_users', error)
    }

    if (wu) {
      set({
        session,
        webUser: { id: wu.id, username: wu.username, first_name: wu.first_name, last_name: wu.last_name, role: wu.role, cooperatives: get().cooperative },
        loading: false,
      })
    } else {
      await supabase.auth.signOut()
      set({ session: null, webUser: null, loading: false })
    }
  },

  signIn: async (username, password) => {
    const { data, error } = await supabase.functions.invoke('auth-web', {
      body: { username, password, cooperativeId: get().cooperative?.id },
    })

    if (error) {
      let message = 'Error de conexión'
      try {
        const body = await error.context?.json?.()
        if (body?.error) message = body.error
      } catch {
        // fallback al mensaje genérico
      }
      throw new Error(message)
    }
    if (data?.error) throw new Error(data.error)

    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })

    if (sessionError) throw sessionError

    const webUser = {
      id: data.user_id,
      username: data.username,
      first_name: data.first_name,
      last_name: data.last_name,
      role: data.role,
      cooperatives: get().cooperative,
    }

    set({ session: sessionData.session, webUser })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, webUser: null })
  },
}))
