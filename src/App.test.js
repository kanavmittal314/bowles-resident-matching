import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

function uploadCsv(input, name, text) {
  const file = new File([text], name, { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

async function goNext() {
  const nextButton = screen.getByRole("button", { name: /next/i });
  await waitFor(() => expect(nextButton).not.toBeDisabled());
  fireEvent.click(nextButton);
}

function setRoomInventory({ singles = 0, doubles = 1 } = {}) {
  fireEvent.change(screen.getByLabelText(/single rooms/i), { target: { value: String(singles) } });
  fireEvent.change(screen.getByLabelText(/double rooms/i), { target: { value: String(doubles) } });
}

function mapRequiredColumns() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "name" } });
  fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "gender" } });
  fireEvent.change(screen.getByLabelText("Sleep"), { target: { value: "preference" } });
}

test("renders the Bowles resident matching workspace", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /bowles resident matching/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /open workflow tutorial/i })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /upload files/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /download matches/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  expect(screen.queryByLabelText(/optimization mode/i)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/single rooms/i)).toHaveValue(0);
  expect(screen.getByLabelText(/double rooms/i)).toHaveValue(0);
});

test("previews uploaded files and discovers preference key values", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "Name,Gender,Sleep\nAvery,F,Early\nBlair,F,Late\n"
  );

  expect(await screen.findByText("Preferences Preview")).toBeInTheDocument();
  setRoomInventory({ doubles: 1 });
  await goNext();
  expect(screen.getByRole("heading", { name: /map columns/i })).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Gender")).toHaveValue("");
  expect(screen.getByLabelText("Sleep")).toHaveValue("");
  expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  mapRequiredColumns();
  await goNext();
  expect(screen.getByRole("heading", { name: /encode preferences/i })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText(/sleep weight/i)).toBeInTheDocument());
  expect(screen.getAllByText("Early").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Late").length).toBeGreaterThan(0);
});

test("blocks upload step when there are not enough beds", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "Name,Gender,Sleep\nAvery,F,Early\nBlair,F,Late\nCasey,F,Early\n"
  );

  expect(await screen.findByText("Preferences Preview")).toBeInTheDocument();
  setRoomInventory({ doubles: 1 });

  expect(screen.getByText(/not enough beds for the uploaded file/i)).toBeInTheDocument();
  expect(screen.getAllByText(/add 1 more bed/i).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
});

test("supports extra information and ignored column mappings", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "Name,Gender,Sleep,Notes,Unused\nAvery,F,Early,Prefers quiet,Ignore me\nBlair,F,Late,Needs sunlight,Ignore too\n"
  );

  await screen.findByText("Preferences Preview");
  setRoomInventory({ doubles: 1 });
  await goNext();
  mapRequiredColumns();
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "misc" } });
  fireEvent.change(screen.getByLabelText("Unused"), { target: { value: "" } });
  await goNext();
  await goNext();

  fireEvent.click(screen.getAllByRole("button", { name: /see more/i })[0]);
  expect(screen.getByText("Extra Information")).toBeInTheDocument();
  expect(screen.getByText("Prefers quiet")).toBeInTheDocument();
  expect(screen.queryByText("Ignore me")).not.toBeInTheDocument();
});

test("orders card preferences by descending configured weight", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "Name,Gender,Sleep,Cleanliness\nAvery,F,Early,Tidy\nBlair,F,Late,Relaxed\n"
  );

  await screen.findByText("Preferences Preview");
  setRoomInventory({ doubles: 1 });
  await goNext();
  mapRequiredColumns();
  fireEvent.change(screen.getByLabelText("Cleanliness"), { target: { value: "preference" } });
  await goNext();
  fireEvent.change(screen.getByLabelText(/sleep weight/i), { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText(/cleanliness weight/i), { target: { value: "5" } });
  await goNext();

  const averyCard = screen.getByText("Avery").closest("article");
  expect(averyCard).not.toHaveTextContent("Cleanliness");
  fireEvent.click(averyCard.querySelector("button"));
  expect(averyCard.textContent.indexOf("Cleanliness")).toBeLessThan(averyCard.textContent.indexOf("Sleep"));
});

test("concatenates multiple columns mapped to name", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "First,Last,Gender,Sleep\nAvery,Stone,F,Early\nBlair,Patel,F,Late\n"
  );

  await screen.findByText("Preferences Preview");
  setRoomInventory({ doubles: 1 });
  await goNext();
  fireEvent.change(screen.getByLabelText("First"), { target: { value: "name" } });
  fireEvent.change(screen.getByLabelText("Last"), { target: { value: "name" } });
  fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "gender" } });
  fireEvent.change(screen.getByLabelText("Sleep"), { target: { value: "preference" } });
  await goNext();
  await goNext();

  expect(await screen.findByText("Avery Stone")).toBeInTheDocument();
  expect(screen.getByText("Blair Patel")).toBeInTheDocument();
});

test("accepts preferences file by drag and drop", async () => {
  render(<App />);

  fireEvent.drop(screen.getByText(/preferences csv/i).closest("label"), {
    dataTransfer: {
      files: [new File(["Name,Gender,Sleep\nAvery,F,Early\n"], "preferences.csv", { type: "text/csv" })],
    },
  });

  expect(await screen.findByText("Preferences Preview")).toBeInTheDocument();
  setRoomInventory({ singles: 1, doubles: 0 });
  await goNext();
  mapRequiredColumns();
  await goNext();
  await goNext();
  await waitFor(() => expect(screen.getByRole("button", { name: /optimize unassigned/i })).not.toBeDisabled());
  expect(screen.getByLabelText(/max solve time/i)).toHaveValue(10);
  expect(screen.getByRole("button", { name: /download matches/i })).toBeInTheDocument();
});

test("groups unassigned students by gender and ignores unmapped extra columns", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "Name,Gender,Sleep,Would you be willing to room with a (check all that apply):\nAvery,F,Early,\"[F, M]\"\nBlair,F,Late,[F]\nCasey,M,Early,[M]\n"
  );

  await screen.findByText("Preferences Preview");
  setRoomInventory({ doubles: 2 });
  await goNext();
  mapRequiredColumns();
  expect(screen.getByLabelText("Would you be willing to room with a (check all that apply):")).toHaveValue("");
  await goNext();
  await goNext();

  expect((await screen.findAllByText("Avery")).length).toBeGreaterThan(0);
  expect(screen.queryByText("Willing to room with")).not.toBeInTheDocument();
  expect(screen.queryByText("F, M")).not.toBeInTheDocument();
  expect(screen.getAllByText("F").length).toBeGreaterThan(0);
  expect(screen.getAllByText("M").length).toBeGreaterThan(0);
});

test("shows flat room cards with draggable assigned student cards", async () => {
  render(<App />);

  uploadCsv(
    screen.getByLabelText(/preferences csv/i),
    "preferences.csv",
    "Name,Gender,Sleep\nAvery,North,Early\nBlair,North,Late\nCasey,South,Early\nDevon,South,Late\nEmery,East,Early\n"
  );

  await screen.findByText("Preferences Preview");
  setRoomInventory({ doubles: 3 });
  await goNext();
  mapRequiredColumns();
  await goNext();
  await goNext();

  fireEvent.click(screen.getByText("Avery"));
  fireEvent.click(screen.getByText("Double 1"));
  fireEvent.click(screen.getByText("Blair"));
  fireEvent.click(screen.getByText("Double 1"));
  fireEvent.click(screen.getByText("Casey"));
  fireEvent.click(screen.getByText("Double 2"));

  const roomBoard = screen.getByLabelText("Room assignment board");
  expect(roomBoard.textContent).toContain("Double 1");
  expect(roomBoard.textContent).toContain("Double 2");
  expect(roomBoard.textContent).not.toContain("Unassigned");

  const assignedAveryCard = screen.getAllByText("Avery").find((node) => roomBoard.contains(node))?.closest("article");
  expect(assignedAveryCard).toHaveAttribute("draggable", "true");
  expect(assignedAveryCard).not.toHaveTextContent("Sleep");
  fireEvent.click(assignedAveryCard.querySelector("button"));
  expect(assignedAveryCard).toHaveTextContent("Sleep");
});
