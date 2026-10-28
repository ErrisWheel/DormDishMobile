import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as ImagePicker from 'expo-image-picker';

const API_BASE = (process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4000/api' : 'http://localhost:4000/api')).replace(/\/$/, '');
const WEBSITE_BASE = (process.env.EXPO_PUBLIC_WEBSITE_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:5173' : 'http://localhost:5173')).replace(/\/$/, '');
const FALLBACK_IMAGE = 'https://placehold.co/720x480/F3F4EC/314234?text=DormDish';
const money = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
const dateText = (v) => v ? new Date(v).toLocaleString() : 'Not set';

async function request(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : {};
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function Button({ title, onPress, secondary = false, disabled = false, danger = false }) {
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.button, secondary && styles.buttonSecondary, danger && styles.buttonDanger, disabled && styles.disabled]}>
    <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText, danger && styles.buttonDangerText]}>{title}</Text>
  </Pressable>;
}
function Field({ label, value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder || label} placeholderTextColor="#81877E" secureTextEntry={secureTextEntry} keyboardType={keyboardType} multiline={multiline} style={[styles.input, multiline && styles.multiline]} /></View>;
}
function Section({ title, subtitle, children, right }) {
  return <View style={styles.section}><View style={styles.sectionHeader}><View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View>{right}</View>{children}</View>;
}
function Message({ error }) { return error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null; }
function ProductImage({ uri, style }) { const [failed, setFailed] = useState(false); const resolved = uri && uri.startsWith('/') ? `${WEBSITE_BASE}${uri}` : uri; return <Image source={{ uri: !failed && resolved ? resolved : FALLBACK_IMAGE }} onError={() => setFailed(true)} style={style} />; }
function Status({ value }) { return <View style={styles.statusPill}><Text style={styles.statusText}>{value}</Text></View>; }

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync('dormdish-session');
        if (raw) {
          const saved = JSON.parse(raw);
          const me = await request('/auth/me', saved.token);
          setSession({ token: saved.token, user: me.user });
        }
      } catch {
        await SecureStore.deleteItemAsync('dormdish-session').catch(() => {});
      } finally { setBooting(false); }
    })();
  }, []);

  async function login() {
    setBusy(true); setError('');
    try {
      const result = await request('/auth/login', '', { method: 'POST', body: { email: email.trim(), password } });
      const next = { token: result.token, user: result.user };
      await SecureStore.setItemAsync('dormdish-session', JSON.stringify(next));
      setSession(next); setPassword('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function logout() {
    await SecureStore.deleteItemAsync('dormdish-session').catch(() => {});
    setSession(null); setError('');
  }

  if (booting) return <SafeAreaView style={styles.center}><ActivityIndicator size="large" color="#2F6946"/><Text style={styles.body}>Loading DormDish…</Text></SafeAreaView>;
  if (!session) return <SafeAreaView style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.loginWrap}><View style={styles.brandMark}><Text style={styles.brandMarkText}>D</Text></View><Text style={styles.brand}>DormDish</Text><Text style={styles.loginTitle}>Welcome back</Text><Text style={styles.subtitle}>Sign in to your DormDish account.</Text><Message error={error}/><Field label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address"/><Field label="Password" value={password} onChangeText={setPassword} secureTextEntry/><Button title={busy ? 'Signing in…' : 'Sign in'} onPress={login} disabled={busy || !email.trim() || !password}/><Text style={styles.helper}>API: {API_BASE}</Text></KeyboardAvoidingView></SafeAreaView>;

  const shared = { token: session.token, user: session.user, onLogout: logout, onError: setError, error, clearError: () => setError('') };
  return <SafeAreaView style={styles.safe}><View style={styles.appHeader}><View><Text style={styles.brand}>DormDish</Text><Text style={styles.headerUser}>{session.user.name} · {session.user.role.replaceAll('_', ' ')}</Text></View><Pressable onPress={logout} style={styles.logout}><Text style={styles.logoutText}>Sign out</Text></Pressable></View>
    {session.user.role === 'customer' ? <CustomerHome {...shared}/> : null}
    {session.user.role === 'rider' ? <RiderHome {...shared}/> : null}
    {session.user.role === 'store_manager' ? <ManagerHome {...shared}/> : null}
    {session.user.role === 'superadmin' ? <AdminHome {...shared}/> : null}
  </SafeAreaView>;
}

function CustomerHome({ token, user, onError, error, clearError }) {
  const [stores, setStores] = useState([]); const [store, setStore] = useState(null); const [products, setProducts] = useState([]);
  const [cart, setCart] = useState({}); const [address, setAddress] = useState(''); const [orders, setOrders] = useState([]); const [tab, setTab] = useState('stores'); const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); try { const [s,o] = await Promise.all([request('/stores',token),request('/orders',token)]);setStores(s.stores||[]);setOrders(o.orders||[]); } catch(e){onError(e.message);} finally{setLoading(false);} },[token]);
  useEffect(()=>{refresh();},[refresh]);
  async function selectStore(next){setStore(next);setProducts([]);setCart({});try{const r=await request(`/stores/${next.id}/products`,token);setProducts(r.products||[]);}catch(e){onError(e.message);}}
  function add(product){setCart(c=>({...c,[product.id]:{product,quantity:Math.min(50,(c[product.id]?.quantity||0)+1)}}));}
  function adjust(id,delta){setCart(c=>{const item=c[id];if(!item)return c;const quantity=item.quantity+delta;if(quantity<=0){const n={...c};delete n[id];return n;}return {...c,[id]:{...item,quantity}};});}
  const lines=Object.values(cart);const subtotal=lines.reduce((s,x)=>s+Number(x.product.price)*x.quantity,0);
  async function checkout(){if(!address.trim()){onError('Enter a delivery address.');return;}if(!lines.length){onError('Add at least one item before checking out.');return;}clearError();try{await request('/orders',token,{method:'POST',body:{storeId:store.id,items:lines.map(x=>({productId:x.product.id,quantity:x.quantity})),deliveryAddress:address.trim(),paymentMethod:'Cash on delivery'}});Alert.alert('Order placed','Your order was submitted successfully.');setCart({});setStore(null);setTab('orders');await refresh();}catch(e){onError(e.message);}}
  return <ScrollView contentContainerStyle={styles.content}><Message error={error}/><View style={styles.tabs}><Tab title="Stores & menu" active={tab==='stores'} onPress={()=>setTab('stores')}/><Tab title="My orders" active={tab==='orders'} onPress={()=>setTab('orders')}/></View>
    {tab==='stores'?<>
      {!store?<Section title="Browse stores" subtitle="Choose a store to view the current menu.">{loading?<ActivityIndicator color="#2F6946"/>:stores.map(s=><Pressable style={styles.storeRow} key={s.id} onPress={()=>selectStore(s)}><ProductImage uri={s.image_url} style={styles.storeImage}/><View style={styles.flex}><Text style={styles.cardTitle}>{s.name}</Text><Text style={styles.subtitle}>{s.description}</Text><Text style={styles.meta}>{s.rating?`${s.rating} ★ · `:''}{s.product_count||0} available products</Text></View><Text style={styles.chevron}>›</Text></Pressable>)}</Section>:<>
        <Button title="← All stores" secondary onPress={()=>{setStore(null);setCart({});}}/><Section title={store.name} subtitle={store.location_name}><Text style={styles.body}>{store.description}</Text><Button title="Open store map" secondary onPress={()=>Alert.alert('Store location',store.maps_url||store.location_name)}/></Section>
        <Section title="Menu" subtitle="Tap Add to build your cart">{products.map(p=><View style={styles.productRow} key={p.id}><ProductImage uri={p.image_url} style={styles.productImage}/><View style={styles.flex}><Text style={styles.cardTitle}>{p.name}</Text><Text style={styles.subtitle}>{p.description}</Text><Text style={styles.price}>{money(p.price)}</Text><Text style={styles.meta}>{Number(p.stock)>0?`${p.stock} left`:'Out of stock'}{p.promo_active?' · Special offer':''}</Text></View><Button title="Add" onPress={()=>add(p)} disabled={!p.stock||!p.is_available}/></View>)}</Section>
        <Section title={`Cart · ${lines.reduce((n,x)=>n+x.quantity,0)} item(s)`} subtitle={`Subtotal ${money(subtotal)} · delivery fee calculated at checkout`}>{lines.length?lines.map(x=><View style={styles.cartLine} key={x.product.id}><Text style={[styles.body,styles.flex]}>{x.quantity} × {x.product.name}</Text><Button title="−" secondary onPress={()=>adjust(x.product.id,-1)}/><Button title="+" secondary onPress={()=>adjust(x.product.id,1)}/></View>):<Text style={styles.subtitle}>Your cart is empty.</Text>}{lines.length?<><Field label="Delivery address" value={address} onChangeText={setAddress} placeholder="Dorm / building / room"/><Button title="Place cash-on-delivery order" onPress={checkout}/></>:null}</Section>
      </>}
    </>:<Section title="My orders" subtitle="Order status and delivery information refresh from the server.">{loading?<ActivityIndicator color="#2F6946"/>:orders.length?orders.map(o=><View key={o.id} style={styles.card}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{o.store_name}</Text><Status value={o.status}/></View><Text style={styles.meta}>{o.id} · {dateText(o.created_at)}</Text><Text style={styles.body}>{o.items?.map(i=>`${i.quantity} × ${i.product_name}`).join(', ')}</Text><Text style={styles.price}>{money(o.total)}</Text><Text style={styles.subtitle}>Deliver to: {o.delivery_address}</Text>{o.eta_at?<Text style={styles.subtitle}>ETA: {dateText(o.eta_at)}</Text>:null}</View>):<Text style={styles.subtitle}>No orders yet.</Text>}</Section>}
  </ScrollView>;
}

function ManagerHome({ token, user, onError, error, clearError }) {
  const [tab,setTab]=useState('products');const [products,setProducts]=useState([]);const [orders,setOrders]=useState([]);const [riders,setRiders]=useState([]);const [busy,setBusy]=useState(false);const [editing,setEditing]=useState(null);
  const blank={name:'',description:'',category:'Rice Meals',price:'',stock:'10',imageUrl:'',isAvailable:true};const [form,setForm]=useState(blank);
  const refresh=useCallback(async()=>{setBusy(true);try{const [p,o,r]=await Promise.all([request(`/products?storeId=${user.store_id}`,token),request('/orders',token),request('/manager/riders',token)]);setProducts(p.products||[]);setOrders(o.orders||[]);setRiders(r.riders||[]);}catch(e){onError(e.message);}finally{setBusy(false);}},[token,user.store_id]);
  useEffect(()=>{refresh();},[refresh]);
  function setField(k,v){setForm(f=>({...f,[k]:v}));}
  async function pickPhoto(){try{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[4,3],quality:0.8,base64:true});if(result.canceled)return;const img=result.assets[0];if(!img.base64){onError('Could not read the chosen image. Try another photo.');return;}if((img.fileSize||0)>5*1024*1024){onError('Choose an image smaller than 5 MB.');return;}setBusy(true);const upload=await request('/uploads/products',token,{method:'POST',body:{filename:img.fileName||'product-image.jpg',mimeType:img.mimeType||'image/jpeg',data:`data:${img.mimeType||'image/jpeg'};base64,${img.base64}`}});setField('imageUrl',upload.url);clearError();}catch(e){onError(e.message);}finally{setBusy(false);}}
  function editProduct(p){setEditing(p.id);setForm({name:p.name,description:p.description||'',category:p.category||'Meals',price:String(p.regular_price??p.price),stock:String(p.stock),imageUrl:p.image_url||'',isAvailable:Boolean(p.is_available),oldPrice:(p.promo_active||p.old_price===null)?null:p.old_price,promoPrice:p.promo_price??null,promoLabel:p.promo_label||'',promoStartsAt:p.promo_starts_at||null,promoEndsAt:p.promo_ends_at||null,isPromoted:Boolean(p.is_promoted)});}
  async function saveProduct(){clearError();try{const body={...form,price:Number(form.price),stock:Number(form.stock),oldPrice:form.oldPrice??null,promoPrice:form.promoPrice??null,promoLabel:form.promoLabel||'',promoStartsAt:form.promoStartsAt||null,promoEndsAt:form.promoEndsAt||null,isPromoted:Boolean(form.isPromoted)};await request(editing?`/products/${editing}`:'/products',token,{method:editing?'PUT':'POST',body});setEditing(null);setForm(blank);await refresh();}catch(e){onError(e.message);}}
  const transitions={Pending:['Confirmed','Cancelled'],Confirmed:['Preparing','Cancelled'],Preparing:['Ready for Pickup','Cancelled'],'Ready for Pickup':['Out for Delivery','Cancelled'],'Out for Delivery':['Delivered','Cancelled'],Delivered:[],Cancelled:[]};
  async function progress(order,status){try{await request(`/orders/${encodeURIComponent(order.id)}/progress`,token,{method:'PATCH',body:{status,etaMinutes:status==='Delivered'?null:(order.eta_minutes??20),note:'Updated by store manager',locationLabel:''}});await refresh();}catch(e){onError(e.message);}}
  async function assign(order,riderId){try{await request(`/orders/${encodeURIComponent(order.id)}/assign-rider`,token,{method:'PATCH',body:{riderId:riderId||null}});await refresh();}catch(e){onError(e.message);}}
  return <ScrollView contentContainerStyle={styles.content}><Message error={error}/><View style={styles.tabs}><Tab title="Products" active={tab==='products'} onPress={()=>setTab('products')}/><Tab title="Orders" active={tab==='orders'} onPress={()=>setTab('orders')}/></View>
    {tab==='products'?<>
      <Section title={editing?'Edit product':'Product manager'} subtitle="Manage the same store menu used on the website.">{editing?<Button title="Cancel editing" secondary onPress={()=>{setEditing(null);setForm(blank);}}/>:null}<Field label="Product name" value={form.name} onChangeText={v=>setField('name',v)}/><Field label="Description" value={form.description} onChangeText={v=>setField('description',v)} multiline/><Field label="Category" value={form.category} onChangeText={v=>setField('category',v)}/><Field label="Price (₱)" value={form.price} onChangeText={v=>setField('price',v)} keyboardType="decimal-pad"/><Field label="Stock quantity" value={form.stock} onChangeText={v=>setField('stock',v)} keyboardType="number-pad"/><Field label="Image URL (optional)" value={form.imageUrl} onChangeText={v=>setField('imageUrl',v)}/>{form.imageUrl?<ProductImage uri={form.imageUrl} style={styles.previewImage}/>:null}<Button title={busy?'Working…':'Choose / upload photo'} secondary onPress={pickPhoto} disabled={busy}/><View style={styles.switchRow}><Text style={styles.body}>Available for ordering</Text><Switch value={form.isAvailable} onValueChange={v=>setField('isAvailable',v)} trackColor={{true:'#2F6946'}}/></View><Button title={editing?'Save changes':'Add product'} onPress={saveProduct} disabled={busy||!form.name.trim()||!form.price}/></Section>
      <Section title="Your products" subtitle={`${products.length} product records`}>{products.map(p=><Pressable onPress={()=>editProduct(p)} key={p.id} style={styles.storeRow}><ProductImage uri={p.image_url} style={styles.productImage}/><View style={styles.flex}><Text style={styles.cardTitle}>{p.name}</Text><Text style={styles.price}>{money(p.price)}</Text><Text style={styles.meta}>{p.stock} in stock · {p.is_available?'Available':'Unavailable'}</Text></View><Text style={styles.chevron}>Edit ›</Text></Pressable>)}</Section>
    </>:<Section title="Store orders" subtitle="Move orders through the existing order workflow.">{orders.map(o=><View style={styles.card} key={o.id}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{o.customer_name}</Text><Status value={o.status}/></View><Text style={styles.meta}>{o.id} · {money(o.total)}</Text><Text style={styles.body}>{o.items?.map(i=>`${i.quantity} × ${i.product_name}`).join(', ')}</Text><Text style={styles.subtitle}>Deliver to: {o.delivery_address}</Text><Text style={styles.label}>Assign rider</Text><View style={styles.chipWrap}><Button title="Unassigned" secondary onPress={()=>assign(o,null)}/>{riders.map(r=><Button key={r.id} title={`${r.name}${Number(r.id)===Number(o.rider_id)?' ✓':''}`} secondary onPress={()=>assign(o,r.id)}/>)}</View><View style={styles.chipWrap}>{(transitions[o.status]||[]).map(s=><Button key={s} title={s} onPress={()=>progress(o,s)}/>)}</View></View>)}</Section>}
  </ScrollView>;
}

function RiderHome({ token, user, onError, error }) {
  const [jobs,setJobs]=useState({isOnline:Boolean(user.is_online),available:[],active:[],history:[]});const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{try{setJobs(await request('/rider/jobs',token));}catch(e){onError(e.message);}},[token,onError]);useEffect(()=>{refresh();const t=setInterval(refresh,15000);return()=>clearInterval(t);},[refresh]);
  async function availability(value){setBusy(true);try{await request('/rider/availability',token,{method:'PATCH',body:{isOnline:value}});await refresh();}catch(e){onError(e.message);}finally{setBusy(false);}}
  async function respond(job,action){setBusy(true);try{await request(`/orders/${encodeURIComponent(job.id)}/${action==='accept'?'accept-rider':'decline-rider'}`,token,{method:'POST',body:{}});await refresh();}catch(e){onError(e.message);await refresh();}finally{setBusy(false);}}
  async function progress(order,status){setBusy(true);try{await request(`/orders/${encodeURIComponent(order.id)}/progress`,token,{method:'PATCH',body:{status,note:status==='Delivered'?'Delivery completed.':'Pickup confirmed. On the way.',locationLabel:'',etaMinutes:status==='Delivered'?null:20}});await refresh();}catch(e){onError(e.message);}finally{setBusy(false);}}
  return <ScrollView contentContainerStyle={styles.content}><Message error={error}/><Section title={jobs.isOnline?'You are online':'You are offline'} subtitle={jobs.isOnline?'New delivery offers can be accepted.':'Go online to receive orders ready for pickup.'}><View style={styles.switchRow}><Text style={styles.body}>Accept delivery offers</Text><Switch value={jobs.isOnline} onValueChange={availability} disabled={busy} trackColor={{true:'#2F6946'}}/></View><View style={styles.statsRow}><Stat title="Offers" value={jobs.isOnline?jobs.available.length:'—'}/><Stat title="Active" value={jobs.active.length}/><Stat title="Delivered" value={jobs.history.filter(x=>x.status==='Delivered').length}/></View></Section>
    <Section title="Available jobs" subtitle="Only unassigned orders at your store appear here.">{jobs.isOnline&&jobs.available.length?jobs.available.map(o=><View style={styles.card} key={o.id}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{o.customer_name}</Text><Text style={styles.price}>{money(o.delivery_fee)} fee</Text></View><Text style={styles.meta}>{o.id} · {o.store_name}</Text><Text style={styles.body}>{o.delivery_address}</Text><Text style={styles.subtitle}>{o.items?.map(i=>`${i.quantity} × ${i.product_name}`).join(', ')}</Text><View style={styles.chipWrap}><Button title="Accept delivery" onPress={()=>respond(o,'accept')} disabled={busy}/><Button title="Skip" secondary onPress={()=>respond(o,'decline')} disabled={busy}/></View></View>):<Text style={styles.subtitle}>{jobs.isOnline?'No available offers right now.':'Go online to see job offers.'}</Text>}</Section>
    <Section title="My active deliveries" subtitle="Confirm pickup, then complete the delivery.">{jobs.active.length?jobs.active.map(o=><View style={styles.card} key={o.id}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{o.customer_name}</Text><Status value={o.status}/></View><Text style={styles.meta}>{o.id} · {o.store_name}</Text><Text style={styles.body}>{o.delivery_address}</Text><Text style={styles.subtitle}>{o.items?.map(i=>`${i.quantity} × ${i.product_name}`).join(', ')}</Text><Button title={o.status==='Ready for Pickup'?'Confirm pickup & start delivery':'Mark as delivered'} onPress={()=>progress(o,o.status==='Ready for Pickup'?'Out for Delivery':'Delivered')} disabled={busy}/></View>):<Text style={styles.subtitle}>No active deliveries yet.</Text>}</Section>
    <Section title="Recent history" subtitle="Delivery fee is only shown for reference, not guaranteed rider pay.">{jobs.history.slice(0,10).map(o=><View style={styles.card} key={o.id}><View style={styles.rowBetween}><Text style={styles.cardTitle}>{o.id}</Text><Status value={o.status}/></View><Text style={styles.body}>{o.delivery_address}</Text><Text style={styles.meta}>{dateText(o.updated_at)} · Fee {money(o.delivery_fee)}</Text></View>)}</Section>
  </ScrollView>;
}

function AdminHome({ token, onError, error }) {
  const [tab,setTab]=useState('users');const [users,setUsers]=useState([]);const [stores,setStores]=useState([]);const [loading,setLoading]=useState(false);
  const refresh=useCallback(async()=>{setLoading(true);try{const [u,s]=await Promise.all([request('/admin/users',token),request('/admin/stores',token)]);setUsers(u.users||[]);setStores(s.stores||[]);}catch(e){onError(e.message);}finally{setLoading(false);}},[token,onError]);useEffect(()=>{refresh();},[refresh]);
  return <ScrollView contentContainerStyle={styles.content}><Message error={error}/><View style={styles.tabs}><Tab title="Accounts" active={tab==='users'} onPress={()=>setTab('users')}/><Tab title="Stores" active={tab==='stores'} onPress={()=>setTab('stores')}/></View>{loading?<ActivityIndicator color="#2F6946"/>:tab==='users'?<Section title="Accounts" subtitle={`${users.length} user records`}>{users.map(u=><View style={styles.card} key={u.id}><Text style={styles.cardTitle}>{u.name}</Text><Text style={styles.body}>{u.email}</Text><Text style={styles.meta}>{u.role.replaceAll('_',' ')} · {Number(u.is_active)?'Active':'Disabled'}{u.store_id?` · Store #${u.store_id}`:''}</Text></View>)}</Section>:<Section title="Stores" subtitle={`${stores.length} store records`}>{stores.map(s=><View style={styles.storeRow} key={s.id}><ProductImage uri={s.image_url} style={styles.productImage}/><View style={styles.flex}><Text style={styles.cardTitle}>{s.name}</Text><Text style={styles.subtitle}>{s.location_name}</Text><Text style={styles.meta}>{Number(s.is_active)?'Active':'Inactive'} · {s.manager_name||'No manager assigned'}</Text></View></View>)}</Section>}</ScrollView>;
}
function Tab({ title, active, onPress }) { return <Pressable onPress={onPress} style={[styles.tab,active&&styles.tabActive]}><Text style={[styles.tabText,active&&styles.tabTextActive]}>{title}</Text></Pressable>; }
function Stat({title,value}){return <View style={styles.stat}><Text style={styles.meta}>{title}</Text><Text style={styles.statNumber}>{value}</Text></View>;}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F6F7F1'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12,backgroundColor:'#F6F7F1'},
  loginWrap:{flex:1,justifyContent:'center',paddingHorizontal:24,paddingVertical:32},brandMark:{width:52,height:52,borderRadius:17,backgroundColor:'#2F6946',alignItems:'center',justifyContent:'center',marginBottom:10},brandMarkText:{color:'#fff',fontSize:28,fontWeight:'900'},brand:{fontSize:26,fontWeight:'900',color:'#24382A',letterSpacing:-0.7},loginTitle:{marginTop:36,fontSize:28,fontWeight:'800',color:'#24382A'},subtitle:{color:'#697268',fontSize:14,lineHeight:20,marginTop:4},body:{fontSize:16,color:'#263128',lineHeight:23},helper:{fontSize:12,color:'#7A8277',marginTop:16},
  field:{gap:6,marginTop:14},label:{fontSize:14,fontWeight:'700',color:'#364137'},input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#DCE2D6',borderRadius:12,paddingHorizontal:14,paddingVertical:12,minHeight:48,fontSize:16,color:'#263128'},multiline:{minHeight:84,textAlignVertical:'top'},button:{minHeight:46,paddingHorizontal:15,paddingVertical:11,borderRadius:12,backgroundColor:'#2F6946',alignItems:'center',justifyContent:'center',marginTop:10},buttonText:{fontSize:15,fontWeight:'800',color:'#fff'},buttonSecondary:{backgroundColor:'#EDF1E8',borderWidth:1,borderColor:'#D9E1D5'},buttonSecondaryText:{color:'#2D5135'},buttonDanger:{backgroundColor:'#FCE8E5'},buttonDangerText:{color:'#A93027'},disabled:{opacity:0.5},
  errorBox:{padding:12,borderRadius:10,backgroundColor:'#FDE9E7',borderWidth:1,borderColor:'#F2BDB7',marginTop:12},errorText:{fontSize:14,color:'#9E2F27',lineHeight:20},appHeader:{paddingHorizontal:18,paddingTop:9,paddingBottom:14,backgroundColor:'#fff',borderBottomColor:'#E0E5DC',borderBottomWidth:1,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},headerUser:{fontSize:13,color:'#687268',marginTop:3,textTransform:'capitalize'},logout:{paddingHorizontal:13,paddingVertical:9,borderRadius:10,backgroundColor:'#EDF1E8'},logoutText:{fontSize:14,fontWeight:'800',color:'#2F6946'},content:{paddingHorizontal:15,paddingTop:14,paddingBottom:40,gap:14},tabs:{flexDirection:'row',padding:4,borderRadius:13,backgroundColor:'#E8EDE3',gap:4},tab:{flex:1,padding:11,borderRadius:10,alignItems:'center'},tabActive:{backgroundColor:'#fff',elevation:1},tabText:{fontSize:14,fontWeight:'700',color:'#697268'},tabTextActive:{color:'#2F6946'},section:{backgroundColor:'#fff',borderRadius:16,padding:15,borderWidth:1,borderColor:'#E4E8DF',gap:10},sectionHeader:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between'},sectionHeading:{flex:1},sectionTitle:{fontSize:20,fontWeight:'800',color:'#26382A'},sectionSubtitle:{},storeRow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:9,borderBottomWidth:1,borderBottomColor:'#EDF0E9'},storeImage:{width:76,height:76,borderRadius:12,backgroundColor:'#EEF1E9'},productImage:{width:86,height:86,borderRadius:12,backgroundColor:'#EEF1E9'},previewImage:{width:'100%',height:150,borderRadius:12,backgroundColor:'#EEF1E9'},flex:{flex:1},cardTitle:{fontSize:16,fontWeight:'800',color:'#28392C'},meta:{fontSize:12,color:'#748071',lineHeight:18,marginTop:4},chevron:{fontSize:26,color:'#69836A'},productRow:{flexDirection:'row',alignItems:'center',gap:11,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#E9EDE5'},price:{fontSize:16,fontWeight:'900',color:'#2F6946',marginTop:5},cartLine:{flexDirection:'row',alignItems:'center',gap:6},card:{padding:13,borderRadius:13,borderWidth:1,borderColor:'#E5E9E0',gap:7,marginTop:2},rowBetween:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},statusPill:{backgroundColor:'#EDF1E8',borderRadius:30,paddingHorizontal:10,paddingVertical:6},statusText:{fontSize:12,fontWeight:'800',color:'#2F6946'},switchRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginTop:8},statsRow:{flexDirection:'row',gap:8,marginTop:6},stat:{flex:1,backgroundColor:'#F6F7F1',borderRadius:11,padding:11},statNumber:{fontSize:22,fontWeight:'900',color:'#2F6946',marginTop:4},chipWrap:{flexDirection:'row',flexWrap:'wrap',gap:4},
});
