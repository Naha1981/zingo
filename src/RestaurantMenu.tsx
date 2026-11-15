import { useEffect, useState } from "react";
import { api } from "./client";
export type MenuDish = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
};
export default function RestaurantMenu() {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [category, setCategory] = useState("Sides"),
    [price, setPrice] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [items, setItems] = useState<MenuDish[]>([]);
  const load = () =>
    api.get("/api/profile").then(p=>api.get("/api/restaurants/" + p.data.profile.id + "/menu"))
      .then((r) => setItems(r.data.items))
      .catch(() => setNotice("Menu could not load. Refresh and try again."));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="workspace-panel">
      <h2>Your preview menu</h2>
      <p>
        Add a fictional test dish. It becomes orderable only from your
        restaurant. No real food or payments.
      </p>
      <form
        className="zg-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setNotice("");
          try {
            await api.post("/api/menu-items", {
              name,
              description,
              category,
              price: Number(price),
            });
            setName("");
            setDescription("");
            setPrice("");
            setNotice(
              "Test dish saved. Customers can now order it from your restaurant.",
            );
            await load();
          } catch (e: any) {
            setNotice(e.message || "Could not save dish.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Dish name
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Dish description
          <input
            required
            maxLength={240}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Dish category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {["Burgers", "Pizza", "Chicken", "Sides"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Dish price (ZAR)
          <input
            type="number"
            min="1"
            max="10000"
            step="0.01"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <button className="small-action" disabled={busy}>
          {busy ? "Saving test dish…" : "Add test dish"}
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
      <h3>Saved test dishes ({items.length})</h3>
      {items.map((item) => (
        <div className="panel-title" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
          </div>
          <strong>R{item.price.toFixed(2)}</strong>
        </div>
      ))}
    </section>
  );
}
