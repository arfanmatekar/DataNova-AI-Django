from django.shortcuts import render, redirect
from .models import Product, Cart, Order
from .forms import RegisterForm


def home(request):

    products = Product.objects.all()

    return render(
        request,
        'home.html',
        {'products': products}
    )


def register(request):

    form = RegisterForm()

    if request.method == "POST":

        form = RegisterForm(request.POST)

        if form.is_valid():
            form.save()
            return redirect('/')

    return render(
        request,
        'register.html',
        {'form': form}
    )


def add_to_cart(request, id):

    product = Product.objects.get(id=id)

    cart_item, created = Cart.objects.get_or_create(
        user=request.user,
        product=product
    )

    if not created:
        cart_item.quantity += 1
        cart_item.save()

    return redirect('/')


def cart(request):

    cart_items = Cart.objects.filter(
        user=request.user
    )

    return render(
        request,
        'cart.html',
        {
            'cart_items': cart_items
        }
    )


def checkout(request):

    cart_items = Cart.objects.filter(
        user=request.user
    )

    total = 0

    for item in cart_items:
        total += item.product.price * item.quantity

    if request.method == "POST":

        Order.objects.create(
            user=request.user,
            total_price=total
        )

        cart_items.delete()

        return redirect('/')

    return render(
        request,
        'checkout.html',
        {'total': total}
    )