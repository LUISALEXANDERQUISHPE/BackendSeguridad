const config = require('../config');
const supabase = require('../config/supabase');

/**
 * Valida los datos para el registro.
 */
const validateCredentials = (email, password) => {
  if (!email || !password) {
    return 'Correo y contraseña son requeridos';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Ingresa un correo electrónico válido';
  }

  if (password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres';
  }

  return null;
};

/**
 * Valida los datos para el login.
 */
const validateLogin = (email, password) => {
  if (!email || !password) {
    return 'Correo y contraseña son requeridos';
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Ingresa un correo electrónico válido';
  }

  if (password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres';
  }

  return null;
};

/**
 * Obtiene el perfil de la tabla usuarios.
 *
 * La tabla usuarios utiliza:
 * id
 * nombre_completo
 * correo
 * avatar_url
 * esta_activo
 * creado_en
 * actualizado_en
 */
const ensureProfile = async (user) => {
  const { data: existingProfile, error: selectError } = await supabase
    .from('usuarios')
    .select(`
      id,
      nombre_completo,
      correo,
      avatar_url,
      esta_activo,
      creado_en,
      actualizado_en
    `)
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existingProfile) {
    return existingProfile;
  }

  // Si no existe el perfil, se crea a partir de los datos de Supabase Auth.
  const fullName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    '';

  const { data: profile, error: insertError } = await supabase
    .from('usuarios')
    .insert({
      id: user.id,
      nombre_completo: fullName,
      correo: user.email
    })
    .select(`
      id,
      nombre_completo,
      correo,
      avatar_url,
      esta_activo,
      creado_en,
      actualizado_en
    `)
    .single();

  if (insertError) {
    throw insertError;
  }

  return profile;
};

/**
 * REGISTRO
 */
exports.register = async (req, res, next) => {
  try {
    const {
      email,
      password,
      fullName
    } = req.body;

    const validationError = validateCredentials(
      email,
      password
    );

    if (validationError) {
      return res.status(400).json({
        error: validationError
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verificar si ya existe un perfil con ese correo.
    const { data: existingProfile, error: profileError } = await supabase
      .from('usuarios')
      .select('id')
      .eq('correo', normalizedEmail)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (existingProfile) {
      return res.status(409).json({
        error: 'El usuario ya existe'
      });
    }

    // Crear usuario en Supabase Auth.
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName || ''
        }
      });

    if (authError) {
      if (
        authError.code === 'email_exists' ||
        authError.message?.toLowerCase().includes('already registered')
      ) {
        return res.status(409).json({
          error: 'El usuario ya existe'
        });
      }

      throw authError;
    }

    // Crear el perfil correspondiente en usuarios.
    const { data: profile, error: insertError } = await supabase
      .from('usuarios')
      .insert({
        id: authData.user.id,
        nombre_completo: fullName || '',
        correo: normalizedEmail
      })
      .select(`
        id,
        nombre_completo,
        correo,
        avatar_url,
        esta_activo,
        creado_en,
        actualizado_en
      `)
      .single();

    if (insertError) {
      // Si falla la creación del perfil, eliminar el usuario de Auth
      // para evitar dejar un usuario huérfano.
      await supabase.auth.admin.deleteUser(authData.user.id);

      throw insertError;
    }

    return res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: profile
    });

  } catch (error) {
    next(error);
  }
};

/**
 * LOGIN
 */
exports.login = async (req, res, next) => {
  try {
    const {
      email,
      password
    } = req.body;

    const validationError = validateLogin(
      email,
      password
    );

    if (validationError) {
      return res.status(400).json({
        error: validationError
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Primero verificamos que exista el perfil.
    const { data: profile, error: profileError } = await supabase
      .from('usuarios')
      .select(`
        id,
        nombre_completo,
        correo,
        avatar_url,
        esta_activo,
        creado_en,
        actualizado_en
      `)
      .eq('correo', normalizedEmail)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    if (!profile) {
      return res.status(401).json({
        error: 'Credenciales inválidas'
      });
    }

    // Verificar si la cuenta está activa.
    if (!profile.esta_activo) {
      return res.status(403).json({
        error: 'La cuenta se encuentra desactivada'
      });
    }

    // Autenticar contra Supabase Auth.
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });

    if (authError) {
      return res.status(401).json({
        error: 'Credenciales inválidas'
      });
    }

    // Garantizar que exista el perfil.
    const finalProfile = await ensureProfile(authData.user);

    return res.json({
      message: 'Autenticación exitosa',
      token: authData.session.access_token,
      user: finalProfile
    });

  } catch (error) {
    next(error);
  }
};

/**
 * OBTENER PERFIL
 */
exports.profile = async (req, res, next) => {
  try {
    const profile = await ensureProfile(req.user);

    // Verificar que la cuenta siga activa.
    if (!profile.esta_activo) {
      return res.status(403).json({
        error: 'La cuenta se encuentra desactivada'
      });
    }

    return res.json({
      message: 'Perfil obtenido correctamente',
      user: profile
    });

  } catch (error) {
    next(error);
  }
};