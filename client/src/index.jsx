import { render } from 'solid-js/web';
import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import { io } from 'socket.io-client';

const API = 'http://localhost:3001';

function App() {
  const [token, setToken] = createSignal(localStorage.getItem('token'));
  const [user, setUser] = createSignal(null);
  const [view, setView] = createSignal('login');
  const [email, setEmail] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [code, setCode] = createSignal('');
  const [error, setError] = createSignal('');
  const [messages, setMessages] = createSignal([]);
  const [input, setInput] = createSignal('');
  const [socket, setSocket] = createSignal(null);
  const [typing, setTyping] = createSignal([]);
  const [online, setOnline] = createSignal([]);

  let typingTimeout;
  let messagesEnd;

  createEffect(() => {
    if (token()) {
      fetch(`${API}/api/messages`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
        .then(r => r.json())
        .then(data => setMessages(data))
        .catch(() => {});

      const s = io(API, {
        auth: { token: token() },
        transports: ['websocket']
      });

      s.on('message', msg => {
        setMessages(m => [...m, msg]);
        setTimeout(() => messagesEnd?.scrollIntoView({ behavior: 'smooth' }), 10);
      });

      s.on('typing', data => {
        setTyping(t => {
          if (data.typing) {
            return t.includes(data.username) ? t : [...t, data.username];
          }
          return t.filter(u => u !== data.username);
        });
      });

      s.on('online_users', users => setOnline(users));

      setSocket(s);

      onCleanup(() => s.disconnect());
    }
  });

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    
    const res = await fetch(`${API}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), username: username(), password: password() })
    });

    const data = await res.json();
    
    if (res.ok) {
      setView('verify');
    } else {
      setError(data.error);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');

    const res = await fetch(`${API}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), code: code() })
    });

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      setView('chat');
    } else {
      setError(data.error);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const res = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email(), password: password() })
    });

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem('token', data.token);
      setToken(data.token);
      setUser(data.user);
      setView('chat');
    } else {
      setError(data.error);
    }
  };

  const handleResend = async () => {
    const res = await fetch(`${API}/api/resend-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email() })
    });

    if (res.ok) {
      setError('code resent');
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input().trim() || !socket()) return;

    socket().emit('message', { content: input() });
    setInput('');
  };

  const handleTyping = (val) => {
    setInput(val);

    if (socket()) {
      socket().emit('typing', true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => socket().emit('typing', false), 1000);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setView('login');
    socket()?.disconnect();
  };

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: '#36393f'
    }}>
      <Show when={view() === 'chat' && token()}>
        <div style={{
          width: '240px',
          background: '#2f3136',
          display: 'flex',
          'flex-direction': 'column'
        }}>
          <div style={{
            padding: '16px',
            'border-bottom': '1px solid #202225',
            'font-weight': '600',
            'font-size': '14px'
          }}>
            outlet
          </div>

          <div style={{
            padding: '16px',
            'flex-grow': '1',
            'overflow-y': 'auto'
          }}>
            <div style={{ 'font-size': '12px', 'margin-bottom': '8px', color: '#8e9297', 'text-transform': 'uppercase' }}>
              online — {online().length}
            </div>
            <For each={online()}>
              {u => (
                <div style={{
                  padding: '6px 8px',
                  'border-radius': '4px',
                  'font-size': '14px',
                  display: 'flex',
                  'align-items': 'center',
                  gap: '8px'
                }}>
                  <div style={{
                    width: '8px',
                    height: '8px',
                    'border-radius': '50%',
                    background: '#3ba55d'
                  }} />
                  {u}
                </div>
              )}
            </For>
          </div>

          <div style={{
            padding: '10px',
            background: '#292b2f',
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'center'
          }}>
            <div style={{ 'font-size': '14px' }}>{user()?.username}</div>
            <button
              onClick={logout}
              style={{
                background: 'none',
                border: 'none',
                color: '#b9bbbe',
                cursor: 'pointer',
                padding: '4px 8px',
                'font-size': '12px'
              }}
            >
              logout
            </button>
          </div>
        </div>

        <div style={{
          'flex-grow': '1',
          display: 'flex',
          'flex-direction': 'column'
        }}>
          <div style={{
            padding: '16px',
            'border-bottom': '1px solid #202225',
            'font-weight': '600'
          }}>
            # general
          </div>

          <div style={{
            'flex-grow': '1',
            'overflow-y': 'auto',
            padding: '16px'
          }}>
            <For each={messages()}>
              {msg => (
                <div style={{
                  'margin-bottom': '16px',
                  display: 'flex',
                  gap: '16px'
                }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    'border-radius': '50%',
                    background: '#5865f2',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'flex-shrink': '0',
                    'font-weight': '600'
                  }}>
                    {msg.username[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ 'margin-bottom': '4px' }}>
                      <span style={{ 'font-weight': '500', 'margin-right': '8px' }}>{msg.username}</span>
                      <span style={{ 'font-size': '12px', color: '#72767d' }}>
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div>{msg.content}</div>
                  </div>
                </div>
              )}
            </For>
            <div ref={messagesEnd} />
          </div>

          <div style={{ padding: '16px' }}>
            <Show when={typing().length > 0}>
              <div style={{
                'font-size': '12px',
                color: '#b9bbbe',
                'margin-bottom': '8px'
              }}>
                {typing().join(', ')} {typing().length === 1 ? 'is' : 'are'} typing...
              </div>
            </Show>
            <form onSubmit={sendMessage}>
              <input
                value={input()}
                onInput={(e) => handleTyping(e.target.value)}
                placeholder="message #general"
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#40444b',
                  border: 'none',
                  'border-radius': '8px',
                  color: '#dcddde',
                  'font-size': '14px',
                  outline: 'none'
                }}
              />
            </form>
          </div>
        </div>
      </Show>

      <Show when={view() === 'login'}>
        <div style={{
          width: '100%',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center'
        }}>
          <div style={{
            width: '400px',
            padding: '32px',
            background: '#2f3136',
            'border-radius': '8px'
          }}>
            <h2 style={{ 'margin-bottom': '8px', 'text-align': 'center' }}>welcome to outlet</h2>
            <p style={{ 'margin-bottom': '24px', 'text-align': 'center', color: '#b9bbbe' }}>
              login to continue
            </p>

            <Show when={error()}>
              <div style={{
                padding: '12px',
                background: '#f04747',
                'border-radius': '4px',
                'margin-bottom': '16px',
                'font-size': '14px'
              }}>
                {error()}
              </div>
            </Show>

            <form onSubmit={handleLogin}>
              <input
                type="email"
                placeholder="email"
                value={email()}
                onInput={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  'margin-bottom': '16px',
                  background: '#202225',
                  border: '1px solid #202225',
                  'border-radius': '4px',
                  color: '#dcddde',
                  outline: 'none'
                }}
              />
              <input
                type="password"
                placeholder="password"
                value={password()}
                onInput={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  'margin-bottom': '16px',
                  background: '#202225',
                  border: '1px solid #202225',
                  'border-radius': '4px',
                  color: '#dcddde',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#5865f2',
                  border: 'none',
                  'border-radius': '4px',
                  color: 'white',
                  'font-weight': '500',
                  cursor: 'pointer',
                  'margin-bottom': '8px'
                }}
              >
                login
              </button>
            </form>

            <button
              onClick={() => setView('register')}
              style={{
                width: '100%',
                padding: '12px',
                background: 'transparent',
                border: 'none',
                color: '#00aff4',
                cursor: 'pointer',
                'font-size': '14px'
              }}
            >
              need an account? register
            </button>
          </div>
        </div>
      </Show>

      <Show when={view() === 'register'}>
        <div style={{
          width: '100%',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center'
        }}>
          <div style={{
            width: '400px',
            padding: '32px',
            background: '#2f3136',
            'border-radius': '8px'
          }}>
            <h2 style={{ 'margin-bottom': '8px', 'text-align': 'center' }}>create account</h2>
            <p style={{ 'margin-bottom': '24px', 'text-align': 'center', color: '#b9bbbe' }}>
              join outlet today
            </p>

            <Show when={error()}>
              <div style={{
                padding: '12px',
                background: '#f04747',
                'border-radius': '4px',
                'margin-bottom': '16px',
                'font-size': '14px'
              }}>
                {error()}
              </div>
            </Show>

            <form onSubmit={handleRegister}>
              <input
                type="email"
                placeholder="email"
                value={email()}
                onInput={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  'margin-bottom': '16px',
                  background: '#202225',
                  border: '1px solid #202225',
                  'border-radius': '4px',
                  color: '#dcddde',
                  outline: 'none'
                }}
              />
              <input
                type="text"
                placeholder="username"
                value={username()}
                onInput={(e) => setUsername(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  'margin-bottom': '16px',
                  background: '#202225',
                  border: '1px solid #202225',
                  'border-radius': '4px',
                  color: '#dcddde',
                  outline: 'none'
                }}
              />
              <input
                type="password"
                placeholder="password"
                value={password()}
                onInput={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  'margin-bottom': '16px',
                  background: '#202225',
                  border: '1px solid #202225',
                  'border-radius': '4px',
                  color: '#dcddde',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#5865f2',
                  border: 'none',
                  'border-radius': '4px',
                  color: 'white',
                  'font-weight': '500',
                  cursor: 'pointer',
                  'margin-bottom': '8px'
                }}
              >
                register
              </button>
            </form>

            <button
              onClick={() => setView('login')}
              style={{
                width: '100%',
                padding: '12px',
                background: 'transparent',
                border: 'none',
                color: '#00aff4',
                cursor: 'pointer',
                'font-size': '14px'
              }}
            >
              already have an account? login
            </button>
          </div>
        </div>
      </Show>

      <Show when={view() === 'verify'}>
        <div style={{
          width: '100%',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center'
        }}>
          <div style={{
            width: '400px',
            padding: '32px',
            background: '#2f3136',
            'border-radius': '8px'
          }}>
            <h2 style={{ 'margin-bottom': '8px', 'text-align': 'center' }}>verify email</h2>
            <p style={{ 'margin-bottom': '24px', 'text-align': 'center', color: '#b9bbbe' }}>
              enter the 6-digit code sent to {email()}
            </p>

            <Show when={error()}>
              <div style={{
                padding: '12px',
                background: error() === 'code resent' ? '#43b581' : '#f04747',
                'border-radius': '4px',
                'margin-bottom': '16px',
                'font-size': '14px'
              }}>
                {error()}
              </div>
            </Show>

            <form onSubmit={handleVerify}>
              <input
                type="text"
                placeholder="6-digit code"
                value={code()}
                onInput={(e) => setCode(e.target.value)}
                maxLength="6"
                style={{
                  width: '100%',
                  padding: '12px',
                  'margin-bottom': '16px',
                  background: '#202225',
                  border: '1px solid #202225',
                  'border-radius': '4px',
                  color: '#dcddde',
                  outline: 'none',
                  'text-align': 'center',
                  'font-size': '24px',
                  'letter-spacing': '8px'
                }}
              />
              <button
                type="submit"
                style={{
                  width: '100%',
                  padding: '12px',
                  background: '#5865f2',
                  border: 'none',
                  'border-radius': '4px',
                  color: 'white',
                  'font-weight': '500',
                  cursor: 'pointer',
                  'margin-bottom': '8px'
                }}
              >
                verify
              </button>
            </form>

            <button
              onClick={handleResend}
              style={{
                width: '100%',
                padding: '12px',
                background: 'transparent',
                border: 'none',
                color: '#00aff4',
                cursor: 'pointer',
                'font-size': '14px'
              }}
            >
              resend code
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}

render(() => <App />, document.getElementById('root'));
