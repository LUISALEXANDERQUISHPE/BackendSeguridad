const config = require('../config');
const supabase = require('../config/supabase');

const validateCredentials = (username, email, password) => {
  if (!username || !password) return 'Usuario y contraseña son requeridos';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Ingresa un correo electrónico válido';
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) return 'El usuario debe tener entre 3 y 32 caracteres válidos';
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  return null;
};

const validateLogin = (username, email, password) => {
  if ((!username && !email) || !password) return 'Correo/usuario y contraseña son requeridos';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Ingresa un correo electrónico válido';
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  return null;
};

const buildUsername = (user) => {
  const metadataUsername = user.user_metadata?.username;
  const emailUsername = user.email?.split('@')[0];
  const baseUsername = (metadataUsername || emailUsername || `user_${user.id.slice(0, 8)}`)
    .toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 32);
  return baseUsername.length >= 3 ? baseUsername : `user_${user.id.slice(0, 8)}`;
};

const ensureProfile = async (user) => {
  const { data: existingProfile, error: selectError } = await supabase
    .from('profiles')
    .select('id, username, email, full_name, avatar_url, plan, created_at')
    .eq('id', user.id).maybeSingle();
  if (selectError) throw selectError;
  if (existingProfile) return existingProfile;

  const { data: profile, error: insertError } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      username: buildUsername(user),
      email: user.email,
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || ''
    })
    .select('id, username, email, full_name, avatar_url, plan, created_at').single();
  if (insertError) throw insertError;
  return profile;
};

exports.register = async (req, res, next) => {
  try {
    const { username, email, password, fullName } = req.body;
    const validationError = validateCredentials(username, email, password);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedUsername = username.toLowerCase();
    const { data: existingProfile, error: profileError } = await supabase
      .from('profiles').select('id').or(`username.eq.${normalizedUsername},email.eq.${email.toLowerCase()}`).maybeSingle();
    if (profileError) throw profileError;
    if (existingProfile) return res.status(409).json({ error: 'El usuario ya existe' });

    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { username: normalizedUsername, full_name: fullName || normalizedUsername }
    });
    if (authError) {
      if (authError.code === 'email_exists') return res.status(409).json({ error: 'El usuario ya existe' });
      throw authError;
    }

    const { data: profile, error: insertError } = await supabase
      .from('profiles')
      .upsert({ id: authData.user.id, username: normalizedUsername, email: email.toLowerCase(), full_name: fullName || normalizedUsername }, { onConflict: 'id' })
      .select('id, username, email, full_name, avatar_url, plan, created_at').single();
    if (insertError) {
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw insertError;
    }
    res.status(201).json({ message: 'Usuario registrado exitosamente', user: profile });
  } catch (error) {
    next(error);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    const validationError = validateLogin(username, email, password);
    if (validationError) return res.status(400).json({ error: validationError });

    const normalizedUsername = username ? username.toLowerCase() : null;
    let loginEmail = email?.toLowerCase();
    if (normalizedUsername) {
      const { data: usernameProfile, error: usernameError } = await supabase
        .from('profiles').select('email').eq('username', normalizedUsername).maybeSingle();
      if (usernameError) throw usernameError;
      if (!usernameProfile) return res.status(401).json({ error: 'Credenciales inválidas' });
      loginEmail = usernameProfile.email;
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail, password
    });
    if (authError) return res.status(401).json({ error: 'Credenciales inválidas' });
    const profile = await ensureProfile(authData.user);
    res.json({ message: 'Autenticación exitosa', token: authData.session.access_token, user: profile });
  } catch (error) {
    next(error);
  }
};

exports.profile = async (req, res, next) => {
  try {
    const profile = await ensureProfile(req.user);
    res.json({ message: 'Perfil obtenido correctamente', user: profile });
  } catch (error) {
    next(error);
  }
};
