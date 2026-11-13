// Every screen change: the new screen fades up while a thin amber scan line sweeps the
// view once, like a console switching feeds. Restrained on purpose (opacity only, about
// 0.4 s), and it uses the motion tokens, so Reduce motion turns it off. No transform or
// filter on the wrapper: either would break the fixed hangar and fight scenes inside it.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="cz-route">
      {children}
      <div className="cz-route-sweep" aria-hidden />
    </div>
  )
}
